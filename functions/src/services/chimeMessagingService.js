import { ChimeSDKMessagingClient, CreateChannelCommand, CreateChannelMembershipCommand, ListChannelMessagesCommand, SendChannelMessageCommand, DescribeChannelCommand, ListChannelsCommand, ListChannelMembershipsCommand, CreateChannelModeratorCommand, DeleteChannelMembershipCommand } from '@aws-sdk/client-chime-sdk-messaging'
import { ChimeSDKIdentityClient, CreateAppInstanceUserCommand, DescribeAppInstanceUserCommand } from '@aws-sdk/client-chime-sdk-identity'
import Channel from '../models/Channel.js'
import Message from '../models/Message.js'
import { logger } from '../utils/logger.js'

const REGION = process.env.AWS_REGION
const APP_INSTANCE_ARN = process.env.CHIME_APP_INSTANCE_ARN

if (!REGION || !APP_INSTANCE_ARN) {
  // eslint-disable-next-line no-console
  console.warn('[Chime] Missing AWS_REGION or CHIME_APP_INSTANCE_ARN. Chime service will be disabled until configured.')
}

// Debug: Log AWS configuration
console.log('[Chime] AWS Configuration:', {
  region: REGION,
  appInstanceArn: APP_INSTANCE_ARN,
  hasAwsAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
  hasAwsSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
  hasAwsSessionToken: !!process.env.AWS_SESSION_TOKEN
})

// Debug: Check what AWS identity the backend is using
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
const stsClient = new STSClient({ region: REGION })
stsClient.send(new GetCallerIdentityCommand({})).then(identity => {
  console.log('[Chime] Backend AWS Identity:', { account: identity?.Account, arn: identity?.Arn, userId: identity?.UserId })
}).catch(err => {
  console.log('[Chime] Failed to get AWS identity:', err.message)
})

const identityClient = new ChimeSDKIdentityClient({ region: REGION })
const messagingClient = new ChimeSDKMessagingClient({ region: REGION })

function toAppInstanceUserId(userId) {
  return String(userId)
}

async function ensureAppInstanceUser(user) {
  logger.info('[Chime] ensureAppInstanceUser start', { userId: user._id, userName: user.name })
  if (!user) throw new Error('User is required')
  const appInstanceUserId = toAppInstanceUserId(user._id)
  const appInstanceUserArn = `${APP_INSTANCE_ARN}/user/${appInstanceUserId}`
  logger.info('[Chime] AppInstanceUser ARN', { appInstanceUserArn })
  
  try {
    await identityClient.send(new DescribeAppInstanceUserCommand({ AppInstanceUserArn: appInstanceUserArn }))
    logger.info('[Chime] AppInstanceUser already exists', { appInstanceUserArn })
    return appInstanceUserArn
  } catch (err) {
    // AWS Chime SDK returns ForbiddenException when user doesn't exist, not NotFoundException
    if (err?.name !== 'NotFoundException' && err?.name !== 'ForbiddenException') {
      logger.error('[Chime] Error describing AppInstanceUser', { error: err.message, appInstanceUserArn })
      throw err
    }
    logger.info('[Chime] Creating new AppInstanceUser', { appInstanceUserArn, errorName: err?.name })
    await identityClient.send(new CreateAppInstanceUserCommand({
      AppInstanceArn: APP_INSTANCE_ARN,
      AppInstanceUserId: appInstanceUserId,
      Name: user.name || user.email || appInstanceUserId
    }))
    logger.info('[Chime] AppInstanceUser created successfully', { appInstanceUserArn })
    return appInstanceUserArn
  }
}

async function checkChannelExistsInChime({ name, isDefaultGeneral = false, user }) {
  logger.info('[Chime] checkChannelExistsInChime start', { name, isDefaultGeneral, userId: user._id })
  if (!APP_INSTANCE_ARN) throw new Error('CHIME_APP_INSTANCE_ARN not configured')
  
  try {
    // Ensure we have a valid user ARN for ChimeBearer
    const userArn = await ensureAppInstanceUser(user)
    logger.info('[Chime] Using user ARN as ChimeBearer (listChannels)', { chimeBearer: userArn })
    
    // List all channels in the app instance to find one with matching name
    const listChannelsCommand = new ListChannelsCommand({
      AppInstanceArn: APP_INSTANCE_ARN,
      MaxResults: 50,
      ChimeBearer: userArn
    })
    
    const response = await messagingClient.send(listChannelsCommand)
    const channels = response.Channels || []
    
    // Look for a channel with the same name
    const existingChannel = channels.find(channel => 
      channel.Name === name && 
      (isDefaultGeneral ? channel.Metadata?.includes('isDefaultGeneral') : true)
    )
    
    if (existingChannel) {
      logger.info('[Chime] Channel found in Chime', { 
        channelArn: existingChannel.ChannelArn, 
        name: existingChannel.Name 
      })
      return existingChannel
    }
    
    logger.info('[Chime] Channel not found in Chime', { name })
    return null
  } catch (error) {
    logger.error('[Chime] Error checking channel existence in Chime', { error: error.message })
    throw error
  }
}

async function getChannelMembersFromChime({ channelArn, userArn }) {
  logger.info('[Chime] getChannelMembersFromChime start', { channelArn })
  
  try {
    const response = await messagingClient.send(new ListChannelMembershipsCommand({
      ChannelArn: channelArn,
      ChimeBearer: userArn,
      MaxResults: 50
    }))
    
    const memberships = response.ChannelMemberships || []
    logger.info('[Chime] Retrieved channel memberships from Chime', { 
      count: memberships.length,
      channelArn 
    })
    
    return memberships
  } catch (error) {
    logger.error('[Chime] Error getting channel memberships from Chime', { 
      error: error.message, 
      channelArn 
    })
    throw error
  }
}

async function mapChimeUserArnToMongoUserId({ userArn }) {
  // Extract user ID from ARN: arn:aws:chime:region:account:app-instance/app-instance-id/user/userId
  const arnParts = userArn.split('/')
  const chimeUserId = arnParts[arnParts.length - 1]
  
  // Find user in MongoDB by the Chime user ID (which is our MongoDB user._id)
  const User = (await import('../models/User.js')).default
  const user = await User.findById(chimeUserId)
  
  if (user) {
    logger.info('[Chime] Mapped Chime user ARN to MongoDB user', { 
      userArn, 
      mongoUserId: user._id,
      userName: user.name 
    })
    return user._id
  } else {
    logger.warn('[Chime] Could not find MongoDB user for Chime ARN', { 
      userArn, 
      chimeUserId 
    })
    return null
  }
}

async function syncChannelFromChime({ chimeChannel, createdByUser }) {
  logger.info('[Chime] syncChannelFromChime start', { 
    channelArn: chimeChannel.ChannelArn, 
    name: chimeChannel.Name 
  })
  
  // Check if channel already exists in MongoDB
  let channel = await Channel.findOne({ 
    'chime.channelArn': chimeChannel.ChannelArn 
  })
  
  if (channel) {
    logger.info('[Chime] Channel already synced to MongoDB', { channelId: channel._id })
    return channel
  }
  
  // Get all members from Chime
  const creatorArn = await ensureAppInstanceUser(createdByUser)
  const chimeMemberships = await getChannelMembersFromChime({ 
    channelArn: chimeChannel.ChannelArn, 
    userArn: creatorArn 
  })
  
  // Map Chime user ARNs to MongoDB user IDs
  const memberIds = []
  const adminIds = []
  
  for (const membership of chimeMemberships) {
    const mongoUserId = await mapChimeUserArnToMongoUserId({ 
      userArn: membership.Member.Arn 
    })
    
    if (mongoUserId) {
      memberIds.push(mongoUserId)
      
      // If it's the channel creator or has admin privileges, add to admins
      if (membership.Member.Arn === creatorArn || membership.Type === 'ADMIN') {
        adminIds.push(mongoUserId)
      }
    }
  }
  
  // Ensure the current user is included (in case they're not in Chime yet)
  if (!memberIds.includes(createdByUser._id)) {
    memberIds.push(createdByUser._id)
  }
  if (!adminIds.includes(createdByUser._id)) {
    adminIds.push(createdByUser._id)
  }
  
  logger.info('[Chime] Synced membership data from Chime', { 
    totalMembers: memberIds.length,
    totalAdmins: adminIds.length,
    memberIds: memberIds.slice(0, 5), // Log first 5 for debugging
    adminIds: adminIds.slice(0, 5)
  })
  
  // Create new channel in MongoDB based on Chime data
  const channelData = {
    name: chimeChannel.Name,
    description: chimeChannel.Metadata ? JSON.parse(chimeChannel.Metadata).description : '',
    isPrivate: chimeChannel.Privacy === 'PRIVATE',
    members: memberIds,
    admins: adminIds,
    createdBy: createdByUser._id,
    isDefaultGeneral: chimeChannel.Metadata?.includes('isDefaultGeneral') || false,
    chime: { 
      channelArn: chimeChannel.ChannelArn, 
      mode: chimeChannel.Mode, 
      privacy: chimeChannel.Privacy, 
      type: 'channel' 
    }
  }
  
  channel = await Channel.create(channelData)
  logger.info('[Chime] Channel synced to MongoDB with complete membership data', { 
    channelId: channel._id,
    membersCount: channel.members.length,
    adminsCount: channel.admins.length
  })
  
  return channel
}

async function createChannel({ name, description, isPrivate, createdByUser, isDefaultGeneral = false }) {
  logger.info('[Chime] createChannel start', { name, isDefaultGeneral, createdByUser: createdByUser._id })
  if (!APP_INSTANCE_ARN) throw new Error('CHIME_APP_INSTANCE_ARN not configured')
  
  // First, check if channel already exists in Chime
  const existingChimeChannel = await checkChannelExistsInChime({ name, isDefaultGeneral, user: createdByUser })
  
  if (existingChimeChannel) {
    logger.info('[Chime] Channel already exists in Chime, syncing to MongoDB', { 
      channelArn: existingChimeChannel.ChannelArn 
    })
    return await syncChannelFromChime({ chimeChannel: existingChimeChannel, createdByUser })
  }
  
  // Channel doesn't exist in Chime, create it
  const creatorArn = await ensureAppInstanceUser(createdByUser)
  const privacy = isPrivate ? 'PRIVATE' : 'PUBLIC'
  logger.info('[Chime] Creating new Chime channel', { name, privacy, creatorArn })
  
  const res = await messagingClient.send(new CreateChannelCommand({
    AppInstanceArn: APP_INSTANCE_ARN,
    Name: name,
    Mode: 'RESTRICTED',
    Privacy: privacy,
    ChimeBearer: creatorArn,
    Metadata: description ? JSON.stringify({ description, isDefaultGeneral }) : 
              (isDefaultGeneral ? JSON.stringify({ isDefaultGeneral: true }) : undefined)
  }))
  const channelArn = res.ChannelArn
  logger.info('[Chime] Chime channel created', { channelArn })
  
  const channel = await Channel.create({
    name,
    description,
    isPrivate: !!isPrivate,
    members: [createdByUser._id],
    admins: [createdByUser._id],
    createdBy: createdByUser._id,
    isDefaultGeneral: !!isDefaultGeneral,
    chime: { channelArn, mode: 'RESTRICTED', privacy, type: 'channel' }
  })
  logger.info('[Chime] Channel saved to MongoDB', { channelId: channel._id })
  
  await messagingClient.send(new CreateChannelMembershipCommand({
    ChannelArn: channelArn,
    MemberArn: creatorArn,
    Type: 'DEFAULT',
    ChimeBearer: creatorArn
  }))
  logger.info('[Chime] Creator added as channel member', { channelArn, creatorArn })
  
  // Promote creator to channel moderator in Chime
  try {
    await messagingClient.send(new CreateChannelModeratorCommand({
      ChannelArn: channelArn,
      ChannelModeratorArn: creatorArn,
      ChimeBearer: creatorArn
    }))
    logger.info('[Chime] Creator promoted to channel moderator', { channelArn, creatorArn })
  } catch (err) {
    logger.warn('[Chime] Failed to promote creator to moderator (continuing)', { error: err?.message, channelArn })
  }
  return channel
}

async function addMember({ channelId, user, operatorUser }) {
  // Default operator to the same user if not explicitly provided
  const actingUser = operatorUser || user
  logger.info('[Chime] addMember start', { channelId, userId: user._id, operatorUserId: actingUser._id })
  const channel = await Channel.findById(channelId)
  if (!channel || !channel?.chime?.channelArn) {
    logger.error('[Chime] Channel not found or not mapped to Chime', { channelId, hasChannel: !!channel, hasChannelArn: !!channel?.chime?.channelArn })
    throw new Error('Channel not found or not mapped to Chime')
  }
  const memberArn = await ensureAppInstanceUser(user)
  const operatorArn = await ensureAppInstanceUser(actingUser)
  logger.info('[Chime] Adding member to Chime channel', { channelArn: channel.chime.channelArn, memberArn, operatorArn })
  logger.info('[Chime] Using ChimeBearer for addMember', { chimeBearer: operatorArn })
  
  await messagingClient.send(new CreateChannelMembershipCommand({
    ChannelArn: channel.chime.channelArn,
    MemberArn: memberArn,
    Type: 'DEFAULT',
    ChimeBearer: operatorArn
  }))
  logger.info('[Chime] Member added to Chime channel successfully')
  
  // Use atomic update to prevent race conditions and duplicates
  const updateResult = await Channel.updateOne(
    { 
      _id: channelId, 
      members: { $ne: user._id }  // Only update if user is not already a member
    },
    { 
      $addToSet: { members: user._id }  // $addToSet prevents duplicates
    }
  )
  
  if (updateResult.modifiedCount > 0) {
    logger.info('[Chime] Member added to MongoDB channel', { channelId, userId: user._id })
  } else {
    logger.info('[Chime] Member already in MongoDB channel', { channelId, userId: user._id })
  }
  return channel
}

async function ensureChimeMembership({ channelId, user }) {
  logger.info('[Chime] ensureChimeMembership start', { channelId, userId: user._id })
  const channel = await Channel.findById(channelId)
  if (!channel || !channel?.chime?.channelArn) {
    logger.error('[Chime] Channel not found or not mapped to Chime', { channelId, hasChannel: !!channel, hasChannelArn: !!channel?.chime?.channelArn })
    throw new Error('Channel not found or not mapped to Chime')
  }
  const userArn = await ensureAppInstanceUser(user)
  logger.info('[Chime] Ensuring Chime membership', { channelArn: channel.chime.channelArn, userArn })
  
  try {
    await messagingClient.send(new CreateChannelMembershipCommand({
      ChannelArn: channel.chime.channelArn,
      MemberArn: userArn,
      Type: 'DEFAULT',
      ChimeBearer: userArn
    }))
    logger.info('[Chime] Chime membership ensured successfully')
  } catch (error) {
    // If user is already a member, Chime will return an error - that's okay
    if (error.name === 'ConflictException' || error.message?.includes('already a member')) {
      logger.info('[Chime] User already a member of Chime channel', { channelId, userId: user._id })
    } else {
      logger.error('[Chime] Error ensuring Chime membership', { error: error.message })
      throw error
    }
  }
  
  return channel
}

async function sendMessage({ channelId, author, content }) {
  const channel = await Channel.findById(channelId)
  if (!channel || !channel?.chime?.channelArn) throw new Error('Channel not found or not mapped to Chime')
  const authorArn = await ensureAppInstanceUser(author)
  
  // Ensure the user is a member of the Chime channel before sending a message
  logger.info('[Chime] Ensuring user is member of channel before sending message', { channelId, userId: author._id })
  await addMember({ channelId, user: author })
  
  // Add a small delay to allow Chime membership to propagate
  await new Promise(resolve => setTimeout(resolve, 1000))
  logger.info('[Chime] Membership propagation delay completed')
  
  const res = await messagingClient.send(new SendChannelMessageCommand({
    ChannelArn: channel.chime.channelArn,
    Content: content,
    Type: 'STANDARD',
    ChimeBearer: authorArn,
    Persistence: 'PERSISTENT'
  }))
  const message = await Message.create({
    channelId: channel._id,
    authorId: author._id,
    content,
    isEdited: false,
    externalRef: { provider: 'chime', messageId: res.MessageId, channelArn: channel.chime.channelArn }
  })
  return { message, chime: { messageId: res.MessageId } }
}

async function listMessages({ channelId, nextToken, pageSize = 50, user }) {
  logger.info('[Chime] listMessages start', { channelId, nextToken, pageSize })
  const channel = await Channel.findById(channelId)
  if (!channel || !channel?.chime?.channelArn) {
    logger.error('[Chime] Channel not found or not mapped to Chime', { channelId, hasChannel: !!channel, hasChannelArn: !!channel?.chime?.channelArn })
    throw new Error('Channel not found or not mapped to Chime')
  }
  logger.info('[Chime] Channel found', { channelArn: channel.chime.channelArn })
  
  // Get the user's AppInstanceUser ARN for ChimeBearer
  const appInstanceUserArn = await ensureAppInstanceUser(user)
  logger.info('[Chime] Using AppInstanceUser ARN as ChimeBearer', { appInstanceUserArn })
  
  // Backend-side listing for now; alternatively the frontend can list directly using Cognito credentials
  try {
    const describe = await messagingClient.send(new DescribeChannelCommand({ 
      ChannelArn: channel.chime.channelArn, 
      ChimeBearer: appInstanceUserArn 
    }))
    logger.info('[Chime] Using ChimeBearer for describe/list messages', { chimeBearer: appInstanceUserArn })
    logger.info('[Chime] Channel described successfully', { channelArn: channel.chime.channelArn })
    void describe // suppress unused in case not used in the future
  } catch (err) {
    logger.error('[Chime] Error describing channel', { error: err.message, channelArn: channel.chime.channelArn })
    throw err
  }
  
  try {
    const res = await messagingClient.send(new ListChannelMessagesCommand({
      ChannelArn: channel.chime.channelArn,
      ChimeBearer: appInstanceUserArn,
      MaxResults: pageSize,
      NextToken: nextToken
    }))
    logger.info('[Chime] Messages listed successfully', { messageCount: res.ChannelMessages?.length || 0, nextToken: res.NextToken })

    const chimeMessages = res.ChannelMessages || []

    const messageIds = chimeMessages.map(m => m.MessageId).filter(Boolean)

    try {
      if (messageIds.length > 0) {
        const existingDocs = await Message.find({ 'externalRef.provider': 'chime', 'externalRef.messageId': { $in: messageIds } }, { 'externalRef.messageId': 1 }).lean()
        const existingSet = new Set((existingDocs || []).map(d => d.externalRef?.messageId))
        const ops = []
        for (const m of chimeMessages) {
          if (!existingSet.has(m.MessageId)) {
            ops.push({
              insertOne: {
                document: {
                  channelId: channel._id,
                  authorId: user._id,
                  content: m.Content || '',
                  isEdited: !!m.LastEditedTimestamp,
                  metadata: m.Metadata || null,
                  externalRef: { provider: 'chime', messageId: m.MessageId, channelArn: channel.chime.channelArn },
                  ...(m.CreatedTimestamp ? { createdAt: new Date(m.CreatedTimestamp) } : {}),
                  ...(m.LastEditedTimestamp ? { updatedAt: new Date(m.LastEditedTimestamp) } : {}),
                }
              }
            })
          }
        }
        if (ops.length > 0) {
          await Message.bulkWrite(ops, { ordered: false })
        }
      }
    } catch {}

    let reactionsDocs = []
    try {
      reactionsDocs = await Message.find(
        { 'externalRef.provider': 'chime', 'externalRef.messageId': { $in: messageIds } },
        { 'externalRef.messageId': 1, reactions: 1 }
      ).lean()
    } catch {}
    const idToReactions = new Map()
    for (const d of reactionsDocs || []) {
      idToReactions.set(d.externalRef?.messageId, d.reactions || {})
    }

    const uid = String(user._id)
    const items = chimeMessages.map(m => {
      const r = idToReactions.get(m.MessageId) || {}
      const counts = {
        like: (r.like || []).length,
        love: (r.love || []).length,
        laugh: (r.laugh || []).length,
        wow: (r.wow || []).length,
      }
      const mine = {
        like: Array.isArray(r.like) && r.like.some(id => String(id) === uid),
        love: Array.isArray(r.love) && r.love.some(id => String(id) === uid),
        laugh: Array.isArray(r.laugh) && r.laugh.some(id => String(id) === uid),
        wow: Array.isArray(r.wow) && r.wow.some(id => String(id) === uid),
      }
      return {
        messageId: m.MessageId,
        content: m.Content,
        createdTimestamp: m.CreatedTimestamp,
        lastEditedTimestamp: m.LastEditedTimestamp,
        sender: m.Sender,
        type: m.Type,
        metadata: m.Metadata,
        reactions: counts,
        myReactions: mine,
      }
    })

    return { items, nextToken: res.NextToken }
  } catch (err) {
    logger.error('[Chime] Error listing messages', { error: err.message, channelArn: channel.chime.channelArn })
    throw err
  }
}

export default {
  ensureAppInstanceUser,
  createChannel,
  checkChannelExistsInChime,
  syncChannelFromChime,
  getChannelMembersFromChime,
  mapChimeUserArnToMongoUserId,
  addMember,
  ensureChimeMembership,
  sendMessage,
  listMessages
}


