/**
 * Migration script to promote the admin service account to moderator on all existing channels
 * Run after creating service accounts
 * 
 * Usage: node backups/promote-admin-service.js
 */

import { ChimeSDKMessagingClient, CreateChannelModeratorCommand, ListChannelModeratorsCommand } from '@aws-sdk/client-chime-sdk-messaging'
import mongoose from 'mongoose'
import dotenv from 'dotenv'

// Load environment
dotenv.config()

// Note: Channel model will be imported AFTER MongoDB connection to avoid buffering timeout

const REGION = process.env.AWS_REGION
const APP_INSTANCE_ARN = process.env.CHIME_APP_INSTANCE_ARN
  const MONGODB_URI = process.env.MONGODB_URI || process.env.DATABASE_URL
  const DATABASE_NAME = process.env.MONGODB_DATABASE
const ADMIN_SERVICE_ARN = process.env.CHIME_SERVICE_ADMIN_ARN || `${APP_INSTANCE_ARN}/user/service-admin`

if (!REGION || !APP_INSTANCE_ARN || !MONGODB_URI) {
  console.error('Error: Required environment variables missing')
  console.error('Required: AWS_REGION, CHIME_APP_INSTANCE_ARN, MONGODB_URI')
  process.exit(1)
}

const messagingClient = new ChimeSDKMessagingClient({ region: REGION })

async function promoteAdminOnChannel(channelArn, existingModeratorArn) {
  try {
    // First check if already a moderator using existing moderator's credentials
    try {
      const moderators = await messagingClient.send(new ListChannelModeratorsCommand({
        ChannelArn: channelArn,
        ChimeBearer: existingModeratorArn  // Use existing moderator to list
      }))
      
      const isModerator = moderators.ChannelModerators?.some(
        mod => mod.Moderator?.Arn === ADMIN_SERVICE_ARN
      )
      
      if (isModerator) {
        return { status: 'already_moderator', channelArn }
      }
    } catch (err) {
      // Continue to promote
    }
    
    // Promote service account to moderator using existing moderator's credentials
    await messagingClient.send(new CreateChannelModeratorCommand({
      ChannelArn: channelArn,
      ChannelModeratorArn: ADMIN_SERVICE_ARN,
      ChimeBearer: existingModeratorArn  // ✅ Use existing moderator to promote service account
    }))
    
    return { status: 'promoted', channelArn }
  } catch (err) {
    if (err.name === 'ConflictException') {
      return { status: 'already_moderator', channelArn }
    }
    
    return { status: 'failed', channelArn, error: err.message }
  }
}

async function main() {
  console.log('='.repeat(70))
  console.log('Promote Admin Service Account to Moderator on All Channels')
  console.log('='.repeat(70))
  console.log()
  console.log('Configuration:')
  console.log(`  Region: ${REGION}`)
  console.log(`  App Instance ARN: ${APP_INSTANCE_ARN}`)
  console.log(`  Admin Service ARN: ${ADMIN_SERVICE_ARN}`)
  console.log(`  MongoDB URI: ${MONGODB_URI.substring(0, 30)}...`)
  console.log(`  Database Name: ${DATABASE_NAME}`)
  console.log()
  
  // Connect to MongoDB with better options AND specify database name
  console.log('Connecting to MongoDB...')
  
  // Set global mongoose options BEFORE connecting
  mongoose.set('bufferCommands', false)
  mongoose.set('bufferTimeoutMS', 0)
  
  await mongoose.connect(MONGODB_URI, {
    dbName: DATABASE_NAME,
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 45000,
    maxPoolSize: 10,
    bufferCommands: false,
    autoIndex: false  // Don't build indexes
  })
  console.log(`✓ Connected to MongoDB (database: ${DATABASE_NAME})`)
  
  // Verify connection is ready
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB connection not ready')
  }
  
  // Wait for connection to be fully stable
  await new Promise(resolve => setTimeout(resolve, 2000))
  console.log()
  
  // Use the native MongoDB driver directly to bypass Mongoose model buffering
  console.log('Fetching channels from MongoDB...')
  const db = mongoose.connection.db
  const channelsCollection = db.collection('channels')
  const usersCollection = db.collection('users')
  
  // Query directly using MongoDB driver - get channels with their admins/members
  const channels = await channelsCollection.find({ 
    'chime.channelArn': { $exists: true, $ne: null } 
  })
  .project({ _id: 1, name: 1, 'chime.channelArn': 1, admins: 1, members: 1, createdBy: 1 })
  .maxTimeMS(30000)
  .toArray()
  
  console.log(`✓ Found ${channels.length} channels with Chime mappings`)
  console.log()
  
  // Get all unique user IDs from channels (admins, created by, or first member)
  const userIds = new Set()
  channels.forEach(channel => {
    if (channel.createdBy) userIds.add(channel.createdBy.toString())
    if (channel.admins) channel.admins.forEach(id => userIds.add(id.toString()))
    if (channel.members && channel.members.length > 0) {
      userIds.add(channel.members[0].toString())
    }
  })
  
  console.log(`Fetching ${userIds.size} users to find their Chime ARNs...`)
  const users = await usersCollection.find({ 
    _id: { $in: Array.from(userIds).map(id => new mongoose.Types.ObjectId(id)) }
  })
  .project({ _id: 1 })
  .toArray()
  
  // Create mapping of userId -> Chime ARN
  const userIdToArn = new Map()
  users.forEach(user => {
    const userId = user._id.toString()
    const chimeArn = `${APP_INSTANCE_ARN}/user/${userId}`
    userIdToArn.set(userId, chimeArn)
  })
  
  console.log(`✓ Loaded ${users.length} user ARNs`)
  console.log()
  
  if (channels.length === 0) {
    console.log('No channels to process. Exiting.')
    await mongoose.disconnect()
    process.exit(0)
  }
  
  console.log('Promoting admin service account...')
  console.log()
  
  const results = []
  let processed = 0
  
  for (const channel of channels) {
    processed++
    const channelArn = channel.chime.channelArn
    const channelName = channel.name
    
    process.stdout.write(`[${processed}/${channels.length}] ${channelName}... `)
    
    // Find an existing moderator ARN to use for promotion
    let moderatorArn = null
    
    // Try createdBy first (channel creator should be moderator)
    if (channel.createdBy) {
      const creatorId = channel.createdBy.toString()
      moderatorArn = userIdToArn.get(creatorId)
    }
    
    // If no creator, try first admin
    if (!moderatorArn && channel.admins && channel.admins.length > 0) {
      const adminId = channel.admins[0].toString()
      moderatorArn = userIdToArn.get(adminId)
    }
    
    // If no admin, try first member
    if (!moderatorArn && channel.members && channel.members.length > 0) {
      const memberId = channel.members[0].toString()
      moderatorArn = userIdToArn.get(memberId)
    }
    
    if (!moderatorArn) {
      console.log(`✗ No existing moderator found to perform promotion`)
      results.push({ 
        status: 'failed', 
        channelArn, 
        channelName, 
        channelId: channel._id, 
        error: 'No existing moderator found' 
      })
      continue
    }
    
    const result = await promoteAdminOnChannel(channelArn, moderatorArn)
    results.push({ ...result, channelName, channelId: channel._id })
    
    if (result.status === 'promoted') {
      console.log('✓ Promoted')
    } else if (result.status === 'already_moderator') {
      console.log('✓ Already moderator')
    } else if (result.status === 'failed') {
      console.log(`✗ Failed: ${result.error}`)
    }
  }
  
  console.log()
  console.log('='.repeat(70))
  console.log('Summary')
  console.log('='.repeat(70))
  console.log()
  
  const promoted = results.filter(r => r.status === 'promoted')
  const alreadyModerator = results.filter(r => r.status === 'already_moderator')
  const failed = results.filter(r => r.status === 'failed')
  
  console.log(`Total channels: ${channels.length}`)
  console.log(`  ✓ Newly promoted: ${promoted.length}`)
  console.log(`  ✓ Already moderator: ${alreadyModerator.length}`)
  console.log(`  ✗ Failed: ${failed.length}`)
  console.log()
  
  if (failed.length > 0) {
    console.log('Failed Channels:')
    failed.forEach(r => {
      console.log(`  ✗ ${r.channelName} (${r.channelId}): ${r.error}`)
    })
    console.log()
  }
  
  console.log('='.repeat(70))
  console.log()
  
  if (failed.length === 0) {
    console.log('✓ All channels processed successfully!')
    console.log()
    console.log('Next Steps:')
    console.log('1. Update your chimeMessagingService.js to use service accounts')
    console.log('2. Test admin operations (create channel, grant moderator, etc.)')
    console.log('3. Deploy to production')
  } else {
    console.log('⚠ Some channels failed to process.')
    console.log('Review the errors above and retry if necessary.')
  }
  
  // Disconnect from MongoDB
  await mongoose.disconnect()
  console.log('✓ Disconnected from MongoDB')
  
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  mongoose.disconnect().then(() => {
    process.exit(1)
  })
})

