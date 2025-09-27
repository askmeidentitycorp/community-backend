import { ChimeSDKMessagingClient, CreateChannelCommand, CreateChannelMembershipCommand, ListChannelMessagesCommand, SendChannelMessageCommand, DescribeChannelCommand } from '@aws-sdk/client-chime-sdk-messaging'
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

async function createChannel({ name, description, isPrivate, createdByUser, isDefaultGeneral = false }) {
  logger.info('[Chime] createChannel start', { name, isDefaultGeneral, createdByUser: createdByUser._id })
  if (!APP_INSTANCE_ARN) throw new Error('CHIME_APP_INSTANCE_ARN not configured')
  const creatorArn = await ensureAppInstanceUser(createdByUser)
  const privacy = isPrivate ? 'PRIVATE' : 'PUBLIC'
  logger.info('[Chime] Creating Chime channel', { name, privacy, creatorArn })
  
  const res = await messagingClient.send(new CreateChannelCommand({
    AppInstanceArn: APP_INSTANCE_ARN,
    Name: name,
    Mode: 'RESTRICTED',
    Privacy: privacy,
    ChimeBearer: creatorArn,
    Metadata: description ? JSON.stringify({ description }) : undefined
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
  return channel
}

async function addMember({ channelId, user }) {
  logger.info('[Chime] addMember start', { channelId, userId: user._id })
  const channel = await Channel.findById(channelId)
  if (!channel || !channel?.chime?.channelArn) {
    logger.error('[Chime] Channel not found or not mapped to Chime', { channelId, hasChannel: !!channel, hasChannelArn: !!channel?.chime?.channelArn })
    throw new Error('Channel not found or not mapped to Chime')
  }
  const userArn = await ensureAppInstanceUser(user)
  logger.info('[Chime] Adding member to Chime channel', { channelArn: channel.chime.channelArn, userArn })
  
  await messagingClient.send(new CreateChannelMembershipCommand({
    ChannelArn: channel.chime.channelArn,
    MemberArn: userArn,
    Type: 'DEFAULT',
    ChimeBearer: userArn
  }))
  logger.info('[Chime] Member added to Chime channel successfully')
  
  if (!channel.members.find(id => String(id) === String(user._id))) {
    channel.members.push(user._id)
    await channel.save()
    logger.info('[Chime] Member added to MongoDB channel', { channelId, userId: user._id })
  } else {
    logger.info('[Chime] Member already in MongoDB channel', { channelId, userId: user._id })
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
    
    const items = (res.ChannelMessages || []).map(m => ({
      messageId: m.MessageId,
      content: m.Content,
      createdTimestamp: m.CreatedTimestamp,
      lastEditedTimestamp: m.LastEditedTimestamp,
      sender: m.Sender,
      type: m.Type
    }))
    return { items, nextToken: res.NextToken }
  } catch (err) {
    logger.error('[Chime] Error listing messages', { error: err.message, channelArn: channel.chime.channelArn })
    throw err
  }
}

export default {
  ensureAppInstanceUser,
  createChannel,
  addMember,
  sendMessage,
  listMessages
}


