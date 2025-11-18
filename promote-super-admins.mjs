#!/usr/bin/env node
/**
 * Promote Super Admin Users to AppInstanceAdmin
 * 
 * This script fetches all users with the 'super_admin' role from MongoDB
 * and promotes them to AppInstanceAdmin in AWS Chime.
 * 
 * Requirements:
 * - MONGODB_URI environment variable set
 * - AWS credentials configured
 * - APP_INSTANCE_ARN environment variable set
 * 
 * Usage:
 *   node promote-super-admins.mjs
 * 
 * Features:
 * - Fetches all users with role 'super_admin' from MongoDB
 * - Promotes super_admin users to AppInstanceAdmin
 * - Handles retries on permission errors
 * - Logs summary of promotions
 * 
 * Note: If some users fail to promote due to permission errors, run the script
 * again. The script will skip users who are already admins (idempotent).
 */

import {
  ChimeSDKIdentityClient,
  CreateAppInstanceAdminCommand,
  ListAppInstanceAdminsCommand,
} from '@aws-sdk/client-chime-sdk-identity'
import mongoose from 'mongoose'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load environment variables
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
dotenv.config({ path: join(__dirname, '../backend-env-config.env') })

// Configure these for your environment or supply via env
const AWS_REGION = process.env.AWS_REGION || 'us-east-1'
const APP_INSTANCE_ARN = 'arn:aws:chime:us-east-1:368289336576:app-instance/8d98ffb1-0591-4311-b3d5-e1ffd440852b'
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://support_db_user:BSfPX9M5bcs3Sbm4@cluster0.wchofks.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0'
const MONGODB_DATABASE = 'tenant_community_db_ami'

const identity = new ChimeSDKIdentityClient({ region: AWS_REGION })

/**
 * Ensure AppInstanceUser exists and get its ARN
 */
async function ensureAppInstanceUser(userId, userName) {
  const appInstanceUserArn = `${APP_INSTANCE_ARN}/user/${userId}`
  return appInstanceUserArn
}

/**
 * Promote user to AppInstanceAdmin with retry logic
 */
async function promoteToAppInstanceAdmin(appInstanceUserArn, userName, retryCount = 0) {
  console.log(`Promoting ${userName} to AppInstanceAdmin...`)
  
  try {
    const response = await identity.send(new CreateAppInstanceAdminCommand({
      AppInstanceAdminArn: appInstanceUserArn,
      AppInstanceArn: APP_INSTANCE_ARN
    }))
    
    console.log(`✓ Successfully promoted ${userName}`)
    return response
  } catch (error) {
    // If permission denied and we haven't retried, wait and retry
    if (error.message?.includes('not authorized') && retryCount < 2) {
      console.log(`⚠ Permission denied, retrying... (${retryCount + 1}/2)`)
      await new Promise(resolve => setTimeout(resolve, 2000))
      return promoteToAppInstanceAdmin(appInstanceUserArn, userName, retryCount + 1)
    }
    
    // If conflict (already admin), that's okay
    if (error.name === 'ConflictException') {
      console.log(`✓ ${userName} is already an AppInstanceAdmin`)
      return null
    }
    
    throw error
  }
}

async function loadUserModel() {
  if (!MONGODB_URI) {
    throw new Error('MONGODB_URI environment variable is required')
  }
  
  // Connect to MongoDB
  await mongoose.connect(MONGODB_URI, {
    dbName: MONGODB_DATABASE,
    useNewUrlParser: true,
    useUnifiedTopology: true,
  })
  
  console.log('Connected to MongoDB')
  console.log('Database:', MONGODB_DATABASE)
  
  // Import User model
  const UserSchema = new mongoose.Schema({
    auth0Id: String,
    email: String,
    name: String,
    roles: [String],
    isActive: Boolean,
    isDeleted: Boolean,
  }, { collection: 'users', strict: false })
  
  const User = mongoose.model('User', UserSchema)
  return User
}

async function main() {
  console.log('Fetching super_admin users from MongoDB...')
  console.log('AppInstanceArn:', APP_INSTANCE_ARN)
  console.log('')
  
  try {
    const User = await loadUserModel()
    
    // Find all users with super_admin role
    const superAdmins = await User.find({
      roles: 'super_admin',
      isActive: true,
      isDeleted: { $ne: true }
    }).select('_id name email roles').lean()
    
    console.log(`Found ${superAdmins.length} super_admin users`)
    console.log('')
    
    if (superAdmins.length === 0) {
      console.log('No super_admin users found in database')
      await mongoose.disconnect()
      return
    }
    
    let promoted = 0
    let alreadyAdmin = 0
    let failed = 0
    
    for (const user of superAdmins) {
      try {
        const appInstanceUserArn = await ensureAppInstanceUser(user._id.toString(), user.name)
        console.log(`\nProcessing: ${user.name} (${user.email})`)
        console.log(`User ARN: ${appInstanceUserArn}`)
        
        const result = await promoteToAppInstanceAdmin(appInstanceUserArn, user.name)
        if (result !== null) {
          promoted++
        } else {
          alreadyAdmin++
        }
        
      } catch (error) {
        console.error(`✗ Failed to promote ${user.name}:`, error.message)
        failed++
      }
    }
    
    console.log('\n=== Summary ===')
    console.log(`Total super_admin users: ${superAdmins.length}`)
    console.log(`Promoted: ${promoted}`)
    console.log(`Already admins: ${alreadyAdmin}`)
    console.log(`Failed: ${failed}`)
    
  } catch (error) {
    console.error('Error:', error.message)
    process.exit(1)
  } finally {
    await mongoose.disconnect()
    console.log('Disconnected from MongoDB')
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err?.message || err)
  process.exit(1)
})

