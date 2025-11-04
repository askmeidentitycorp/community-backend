import Channel from '../models/Channel.js'
import Message from '../models/Message.js'
import mongoose from 'mongoose'
import User from '../models/User.js'
import chimeMessagingService from '../services/chimeMessagingService.js'
import { AppError } from '../utils/errorHandler.js'
import ChannelRoleAssignment from '../models/ChannelRoleAssignment.js'
import UnreadCountService from '../services/unreadCountService.js'

export const createChannel = async (req, res, next) => {
  try {
    const { name, description, isPrivate, isDefaultGeneral } = req.body
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const creator = await User.findById(req.auth.userId)
    if (!creator) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    if (isDefaultGeneral) {
      const exists = await Channel.findOne({ isDefaultGeneral: true })
      if (exists) return next(new AppError('General channel already exists', 400, 'ALREADY_EXISTS'))
    }
    const channel = await chimeMessagingService.createChannel({ name, description, isPrivate, createdByUser: creator, isDefaultGeneral, userDetails: req.auth })
    return res.status(201).json({ channel })
  } catch (err) {
    return next(err)
  }
}

export const addMember = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { userId } = req.body
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const user = await User.findById(userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    const operator = await User.findById(req.auth.userId)
    if (!operator) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    const channel = await chimeMessagingService.addMember({ channelId, user, operatorUser: operator })
    return res.json({ channel })
  } catch (err) {
    return next(err)
  }
}

export const removeMember = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { userId } = req.body
    const user = await User.findById(userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    const channel = await Channel.findById(channelId)
    if (!channel || !channel?.chime?.channelArn) return next(new AppError('Channel not found or not mapped to Chime', 404, 'NOT_FOUND'))

    // Remove from Chime (best effort)
    try {
      // Use operator (requester) as ChimeBearer
      if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
      const operator = await User.findById(req.auth.userId)
      const operatorArn = await chimeMessagingService.ensureAppInstanceUser(operator)
      const memberArn = await chimeMessagingService.ensureAppInstanceUser(user)
      await (await import('../services/chimeMessagingService.js')).default // ensure module is loaded
      const { ChimeSDKMessagingClient, DeleteChannelMembershipCommand } = await import('@aws-sdk/client-chime-sdk-messaging')
      const REGION = process.env.AWS_REGION
      const client = new ChimeSDKMessagingClient({ region: REGION })
      await client.send(new DeleteChannelMembershipCommand({
        ChannelArn: channel.chime.channelArn,
        MemberArn: memberArn,
        ChimeBearer: operatorArn
      }))
    } catch {}

    // Remove from Mongo
    await Channel.updateOne({ _id: channelId }, { $pull: { members: user._id, admins: user._id } })
    
    // Clean up unread count tracking for the removed member
    try {
      await UnreadCountService.cleanupUnreadTracking(channelId, user._id.toString())
      console.log('[Controller] Unread count tracking cleaned up for removed member', { channelId, userId: user._id })
    } catch (unreadError) {
      // Log error but don't fail the member removal
      console.error('[Controller] Failed to cleanup unread count tracking', { 
        channelId, 
        userId: user._id, 
        error: unreadError.message 
      })
    }
    
    const updated = await Channel.findById(channelId)
    return res.json({ channel: updated })
  } catch (err) {
    return next(err)
  }
}

export const listChannelModerators = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const assignments = await ChannelRoleAssignment.find({ channelId, role: 'moderator' }).lean()
    const userIds = assignments.map(a => a.userId)
    const users = await User.find({ _id: { $in: userIds } }, 'name email').lean()
    return res.json({ moderators: users })
  } catch (err) {
    return next(err)
  }
}

export const grantChannelModerator = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { userId } = req.body || {}
    if (!userId) return next(new AppError('userId is required', 400, 'VALIDATION_ERROR'))
    const user = await User.findById(userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    const channel = await Channel.findById(channelId)
    if (!channel) return next(new AppError('Channel not found', 404, 'NOT_FOUND'))
    const doc = await ChannelRoleAssignment.findOneAndUpdate(
      { channelId, userId, role: 'moderator' },
      { $setOnInsert: { createdBy: req.auth?.userId } },
      { new: true, upsert: true }
    )
    // Ensure membership
    const isMember = channel.members.some(id => String(id) === String(user._id))
    if (!isMember) {
      await chimeMessagingService.addMember({ channelId, user, operatorUser: req.auth?.userId ? await User.findById(req.auth.userId) : undefined })
    }
    // Also grant moderator in Chime
    try {
      await chimeMessagingService.grantChannelModerator({ channelId, user, operatorUser: req.auth?.userId ? await User.findById(req.auth.userId) : undefined })
    } catch {}
    return res.status(201).json({ success: true, assignment: { channelId, userId, role: 'moderator' } })
  } catch (err) {
    return next(err)
  }
}

export const revokeChannelModerator = async (req, res, next) => {
  try {
    const { channelId, userId } = req.params
    const deleted = await ChannelRoleAssignment.findOneAndDelete({ channelId, userId, role: 'moderator' })
    if (!deleted) return next(new AppError('Moderator assignment not found', 404, 'NOT_FOUND'))
    // Also revoke moderator in Chime
    try {
      const user = await User.findById(userId)
      if (user) {
        await chimeMessagingService.revokeChannelModerator({ channelId, user, operatorUser: req.auth?.userId ? await User.findById(req.auth.userId) : undefined })
      }
    } catch {}
    return res.json({ success: true })
  } catch (err) {
    return next(err)
  }
}

export const ensureGeneralAndJoin = async (req, res, next) => {
  try {
    console.log('[Controller] ensureGeneralAndJoin start', { userId: req.auth?.userId })
    console.log('[Controller] Environment check:', { 
      hasChimeService: !!chimeMessagingService,
      hasChannelModel: !!Channel,
      hasUserModel: !!User 
    })
    
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const user = await User.findById(req.auth.userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    console.log('[Controller] User found', { userId: user._id, userName: user.name })
    
    let channel = await Channel.findOne({ isDefaultGeneral: true })
    console.log('[Controller] General channel lookup', { found: !!channel, channelId: channel?._id })
    
    if (!channel) {
      console.log('[Controller] Creating general channel')
      channel = await chimeMessagingService.createChannel({ name: 'general', description: 'General channel for everyone', isPrivate: false, createdByUser: user, isDefaultGeneral: true })
      console.log('[Controller] General channel created', { channelId: channel._id })
    }
    
    const isMember = channel.members.some(id => String(id) === String(user._id))
    console.log('[Controller] Checking membership', { isMember, userId: user._id, members: channel.members })
    
    if (!isMember) {
      console.log('[Controller] Adding user to general channel')
      channel = await chimeMessagingService.addMember({ channelId: channel._id, user })
      console.log('[Controller] User added to general channel', { channelId: channel._id })
    } else {
      console.log('[Controller] User already member of general channel')
      // Only ensure Chime membership if not already a member
      console.log('[Controller] Ensuring Chime membership')
      await chimeMessagingService.ensureChimeMembership({ channelId: channel._id, user })
    }
    
    return res.json({ channel })
  } catch (err) {
    console.error('[Controller] ensureGeneralAndJoin error', { error: err.message, stack: err.stack })
    return next(err)
  }
}

export const listMessages = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { nextToken, pageSize } = req.query
    console.log('[Controller] listMessages start', { channelId, nextToken, pageSize })
    
    // Get the authenticated user
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const user = await User.findById(req.auth.userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    
    const result = await chimeMessagingService.listMessages({ 
      channelId, 
      nextToken, 
      pageSize: pageSize ? Number(pageSize) : undefined,
      user 
    })
    console.log('[Controller] listMessages success', { itemCount: result.items?.length || 0 })
    return res.json(result)
  } catch (err) {
    console.error('[Controller] listMessages error', { error: err.message, stack: err.stack })
    return next(err)
  }
}

export const sendMessage = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { content } = req.body
    if (!content || !content.trim()) return next(new AppError('Content is required', 400, 'VALIDATION_ERROR'))
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const author = await User.findById(req.auth.userId)
    if (!author) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    const result = await chimeMessagingService.sendMessage({ channelId, author, content })
    return res.status(201).json(result)
  } catch (err) {
    return next(err)
  }
}

export const deleteChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const operator = await User.findById(req.auth.userId)
    if (!operator) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    const result = await chimeMessagingService.deleteChannel({ channelId, operatorUser: operator })
    return res.json(result)
  } catch (err) {
    return next(err)
  }
}

export const deleteChannelMessage = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { messageId } = req.body || {}
    if (!messageId) return next(new AppError('messageId is required', 400, 'VALIDATION_ERROR'))
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const operator = await User.findById(req.auth.userId)
    if (!operator) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    const result = await chimeMessagingService.deleteChannelMessage({ channelId, messageId, operatorUser: operator })
    return res.json(result)
  } catch (err) {
    return next(err)
  }
}

export const redactChannelMessage = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { messageId } = req.body || {}
    if (!messageId) return next(new AppError('messageId is required', 400, 'VALIDATION_ERROR'))
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    
    const operator = await User.findById(req.auth.userId)
    if (!operator) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    
    // Get the message to check if user is the author
    const channel = await Channel.findById(channelId)
    if (!channel) return next(new AppError('Channel not found', 404, 'NOT_FOUND'))
    
    // Find the message in MongoDB
    const message = await Message.findOne({ 
      channelId, 
      'externalRef.provider': 'chime', 
      'externalRef.messageId': messageId 
    }).populate('authorId', 'name _id')
    
    if (!message) return next(new AppError('Message not found', 404, 'NOT_FOUND'))
    
    // Check if user is a moderator
    const moderatorAssignments = await ChannelRoleAssignment.find({ channelId, role: 'moderator' })
    const moderatorUserIds = moderatorAssignments.map(a => String(a.userId))
    const isModerator = moderatorUserIds.includes(String(operator._id))
    
    // Check if user is the author of the message
    // Handle both populated (object with _id) and non-populated (plain ObjectId) cases
    console.log('[Controller] redactChannelMessage - Auth check details:', {
      operatorId: operator._id,
      operatorIdString: String(operator._id),
      messageAuthorId: message.authorId,
      messageAuthorIdType: typeof message.authorId,
      isPopulated: !!(message.authorId && message.authorId._id),
      populatedAuthorId: message.authorId?._id,
      isModerator,
      channelId
    })
    
    const authorIdStr = message.authorId 
      ? String(message.authorId._id || message.authorId) 
      : null
    const isAuthor = authorIdStr && authorIdStr === String(operator._id)
    
    console.log('[Controller] redactChannelMessage - Permission check:', {
      authorIdStr,
      operatorIdStr: String(operator._id),
      isAuthor,
      isModerator,
      willAllow: isModerator || isAuthor
    })
    
    if (!isModerator && !isAuthor) {
      console.error('[Controller] redactChannelMessage - FORBIDDEN:', {
        reason: 'User is neither moderator nor author',
        userId: operator._id,
        messageId,
        messageAuthor: authorIdStr,
        isModerator,
        isAuthor
      })
      return next(new AppError('Only channel moderators can redact messages, or users can redact their own messages', 403, 'FORBIDDEN'))
    }
    
    console.log('[Controller] redactChannelMessage - Permission granted:', {
      userId: operator._id,
      messageId,
      isModerator,
      isAuthor
    })
    
    const result = await chimeMessagingService.redactChannelMessage({ channelId, messageId, operatorUser: operator })
    return res.json(result)
  } catch (err) {
    return next(err)
  }
}

// Mirror a Chime message into Mongo without re-sending to Chime
export const mirrorMessage = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { messageId, content, createdTimestamp, metadata } = req.body || {}
    if (!messageId) return next(new AppError('messageId is required', 400, 'VALIDATION_ERROR'))
    if (!content || !content.trim()) return next(new AppError('content is required', 400, 'VALIDATION_ERROR'))
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))

    const author = await User.findById(req.auth.userId)
    if (!author) return next(new AppError('User not found', 404, 'NOT_FOUND'))

    const channel = await Channel.findById(channelId)
    if (!channel) return next(new AppError('Channel not found', 404, 'NOT_FOUND'))
    if (!channel?.chime?.channelArn) return next(new AppError('Channel not mapped to Chime', 400, 'INVALID_STATE'))

    // Dedupe by externalRef.messageId
    const existing = await Message.findOne({ 'externalRef.provider': 'chime', 'externalRef.messageId': messageId })
    if (existing) {
      return res.json({ message: existing, duplicated: true })
    }

    const doc = {
      channelId: channel._id,
      authorId: author._id,
      content,
      isEdited: false,
      externalRef: { provider: 'chime', messageId, channelArn: channel.chime.channelArn }
    }
    
    // Extract mentions from metadata if provided
    if (metadata) {
      doc.metadata = metadata
      
      // Extract mentions array from metadata.mentions
      if (Array.isArray(metadata.mentions) && metadata.mentions.length > 0) {
        // Validate that all mention IDs are valid ObjectIds
        const validMentions = metadata.mentions.filter(id => mongoose.Types.ObjectId.isValid(id))
        if (validMentions.length > 0) {
          doc.mentions = validMentions
          console.log('[Controller] mirrorMessage extracted mentions', { 
            messageId, 
            mentionCount: validMentions.length,
            mentions: validMentions 
          })
        }
      }
    }
    
    if (createdTimestamp) {
      const ts = new Date(createdTimestamp)
      if (!Number.isNaN(ts.getTime())) Object.assign(doc, { createdAt: ts, updatedAt: ts })
    }

    const saved = await Message.create(doc)
    
    // Increment unread count for all channel members except the sender
    try {
      await UnreadCountService.incrementUnreadCount(channelId, author._id.toString(), {
        messageId: saved._id.toString(),
        messageContent: content.substring(0, 100) // Store truncated content for debugging
      })
      console.log('[Controller] mirrorMessage unread count incremented', { 
        channelId, 
        senderId: author._id,
        messageId: saved._id 
      })
    } catch (unreadError) {
      // Log error but don't fail the request
      console.error('[Controller] mirrorMessage failed to increment unread count', { 
        channelId, 
        senderId: author._id,
        error: unreadError.message 
      })
    }
    
    try {
      const dbName = mongoose?.connection?.db?.databaseName
      const coll = Message?.collection?.collectionName
      console.log('[Controller] mirrorMessage saved', { id: saved?._id, dbName, collection: coll, mentions: saved.mentions })
    } catch {}
    return res.status(201).json({ message: saved })
  } catch (err) {
    return next(err)
  }
}

export const getChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const tenantId = req.auth?.tenantId || ''
    const channel = await Channel.findOne({ _id: channelId, tenantId })
    if (!channel) return next(new AppError('Channel not found', 404, 'NOT_FOUND'))
    return res.json({ channel })
  } catch (err) {
    return next(err)
  }
}

// Helper function that ensures general channel without sending response
export const ensureGeneralChannelOnly = async (req, res, next) => {
  try {
    console.log('[Controller] ensureGeneralChannelOnly start', { userId: req.auth?.userId })
    
    if (!req.auth?.userId) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED')
    const user = await User.findById(req.auth.userId)
    if (!user) throw new AppError('User not found', 404, 'NOT_FOUND')
    console.log('[Controller] User found', { userId: user._id, userName: user.name })
    
    let channel = await Channel.findOne({ isDefaultGeneral: true })
    console.log('[Controller] General channel lookup', { found: !!channel, channelId: channel?._id })
    
    if (!channel) {
      console.log('[Controller] Creating general channel')
      channel = await chimeMessagingService.createChannel({ name: 'general', description: 'General channel for everyone', isPrivate: false, createdByUser: user, isDefaultGeneral: true })
      console.log('[Controller] General channel created', { channelId: channel._id })
    }
    
    const isMember = channel.members.some(id => String(id) === String(user._id))
    console.log('[Controller] Checking membership', { isMember, userId: user._id, members: channel.members })
    
    if (!isMember) {
      console.log('[Controller] Adding user to general channel')
      channel = await chimeMessagingService.addMember({ channelId: channel._id, user })
      console.log('[Controller] User added to general channel', { channelId: channel._id })
    } else {
      console.log('[Controller] User already member of general channel')
      // Still ensure Chime membership even if MongoDB membership exists
      console.log('[Controller] Ensuring Chime membership')
      await chimeMessagingService.ensureChimeMembership({ channelId: channel._id, user })
    }
    
    console.log('[Controller] ensureGeneralChannelOnly completed successfully')
    return channel
  } catch (err) {
    console.error('[Controller] ensureGeneralChannelOnly error', { error: err.message, stack: err.stack })
    throw err
  }
}

export const listChannels = async (req, res, next) => {
  try {
    console.log('[Controller] listChannels start', { userId: req.auth?.userId })
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    
    const user = await User.findById(req.auth.userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    
    // Get channels where user is a member (includes private/public)
    const memberChannels = await Channel.find({ 
      members: user._id,
      isArchived: { $ne: true }
    }).populate('members', 'name email').lean()

    // Get all public channels (discoverable), regardless of membership
    const publicChannels = await Channel.find({ 
      isPrivate: false,
      isArchived: { $ne: true }
    }).populate('members', 'name email').lean()

    // Merge unique by _id, and annotate with isMember
    const byId = new Map()
    for (const ch of publicChannels) {
      byId.set(String(ch._id), { ...ch, isMember: Array.isArray(ch.members) && ch.members.some(m => String(m._id) === String(user._id)) })
    }
    for (const ch of memberChannels) {
      byId.set(String(ch._id), { ...ch, isMember: true })
    }

    // Create final list
    let merged = Array.from(byId.values())

    // Get unread counts for all channels where user is a member
    const channelIds = merged.filter(ch => ch.isMember).map(ch => ch._id)
    const unreadCounts = await UnreadCountService.getUserUnreadSummary(user._id.toString())
    
    // Create a map of channelId -> unreadCount for quick lookup
    const unreadMap = new Map()
    unreadCounts.forEach(item => {
      unreadMap.set(String(item.channelId), item.unreadCount)
    })

    // Add unread count to each channel
    merged = merged.map(channel => ({
      ...channel,
      unreadCount: unreadMap.get(String(channel._id)) || 0,
      hasUnread: (unreadMap.get(String(channel._id)) || 0) > 0
    }))

    // Sort: general first, then by unread count (desc), then by name
    merged.sort((a, b) => {
      if (a.isDefaultGeneral) return -1
      if (b.isDefaultGeneral) return 1
      
      // Sort by unread count (descending) first
      const aUnread = a.unreadCount || 0
      const bUnread = b.unreadCount || 0
      if (aUnread !== bUnread) return bUnread - aUnread
      
      // Then by name
      return String(a.name || '').localeCompare(String(b.name || ''))
    })

    console.log('[Controller] listChannels success', { 
      channelCount: merged.length,
      totalUnread: merged.reduce((sum, ch) => sum + (ch.unreadCount || 0), 0)
    })
    return res.json({ channels: merged })
  } catch (err) {
    console.error('[Controller] listChannels error', { error: err.message, stack: err.stack })
    return next(err)
  }
}

// Reaction handlers
const REACTION_TYPES = new Set(['like', 'love', 'laugh', 'wow'])

export const reactToMessage = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { messageId, type } = req.body || {}
    if (!messageId || !type) return next(new AppError('messageId and type are required', 400, 'VALIDATION_ERROR'))
    if (!REACTION_TYPES.has(type)) return next(new AppError('Invalid reaction type', 400, 'VALIDATION_ERROR'))
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const userId = req.auth.userId

    // Find local message by chime ref
    const msg = await Message.findOne({ 'externalRef.provider': 'chime', 'externalRef.messageId': messageId, channelId })
    if (!msg) return next(new AppError('Message not found', 404, 'NOT_FOUND'))

    const field = `reactions.${type}`
    await Message.updateOne({ _id: msg._id }, { $addToSet: { [field]: userId } })
    const updated = await Message.findById(msg._id).lean()
    const reactions = updated?.reactions || {}
    const payload = {
      reactions: {
        like: (reactions.like || []).length,
        love: (reactions.love || []).length,
        laugh: (reactions.laugh || []).length,
        wow: (reactions.wow || []).length,
      },
      myReactions: {
        like: Array.isArray(reactions.like) && reactions.like.some(id => String(id) === String(userId)),
        love: Array.isArray(reactions.love) && reactions.love.some(id => String(id) === String(userId)),
        laugh: Array.isArray(reactions.laugh) && reactions.laugh.some(id => String(id) === String(userId)),
        wow: Array.isArray(reactions.wow) && reactions.wow.some(id => String(id) === String(userId)),
      }
    }

    // Broadcast via a lightweight STANDARD message with reaction metadata (non-persistent)
    try {
      const channel = await Channel.findById(channelId)
      if (channel?.chime?.channelArn) {
        const operator = await User.findById(req.auth.userId)
        const operatorArn = await chimeMessagingService.ensureAppInstanceUser(operator)
        const { ChimeSDKMessagingClient, SendChannelMessageCommand } = await import('@aws-sdk/client-chime-sdk-messaging')
        const REGION = process.env.AWS_REGION
        const client = new ChimeSDKMessagingClient({ region: REGION })
        const meta = JSON.stringify({ reaction: { messageId, type, counts: payload.reactions } })
        await client.send(new SendChannelMessageCommand({
          ChannelArn: channel.chime.channelArn,
          Content: 'REACTION',
          Type: 'STANDARD',
          Persistence: 'NON_PERSISTENT',
          Metadata: meta,
          ChimeBearer: operatorArn
        }))
      }
    } catch {}

    return res.json(payload)
  } catch (err) {
    return next(err)
  }
}

export const unreactToMessage = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const { messageId, type } = req.body || {}
    if (!messageId || !type) return next(new AppError('messageId and type are required', 400, 'VALIDATION_ERROR'))
    if (!REACTION_TYPES.has(type)) return next(new AppError('Invalid reaction type', 400, 'VALIDATION_ERROR'))
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))
    const userId = req.auth.userId

    const msg = await Message.findOne({ 'externalRef.provider': 'chime', 'externalRef.messageId': messageId, channelId })
    if (!msg) return next(new AppError('Message not found', 404, 'NOT_FOUND'))

    const field = `reactions.${type}`
    await Message.updateOne({ _id: msg._id }, { $pull: { [field]: userId } })
    const updated = await Message.findById(msg._id).lean()
    const reactions = updated?.reactions || {}
    const payload = {
      reactions: {
        like: (reactions.like || []).length,
        love: (reactions.love || []).length,
        laugh: (reactions.laugh || []).length,
        wow: (reactions.wow || []).length,
      },
      myReactions: {
        like: Array.isArray(reactions.like) && reactions.like.some(id => String(id) === String(userId)),
        love: Array.isArray(reactions.love) && reactions.love.some(id => String(id) === String(userId)),
        laugh: Array.isArray(reactions.laugh) && reactions.laugh.some(id => String(id) === String(userId)),
        wow: Array.isArray(reactions.wow) && reactions.wow.some(id => String(id) === String(userId)),
      }
    }

    // Broadcast via a lightweight STANDARD message with reaction metadata (non-persistent)
    try {
      const channel = await Channel.findById(channelId)
      if (channel?.chime?.channelArn) {
        const operator = await User.findById(req.auth.userId)
        const operatorArn = await chimeMessagingService.ensureAppInstanceUser(operator)
        const { ChimeSDKMessagingClient, SendChannelMessageCommand } = await import('@aws-sdk/client-chime-sdk-messaging')
        const REGION = process.env.AWS_REGION
        const client = new ChimeSDKMessagingClient({ region: REGION })
        const meta = JSON.stringify({ reaction: { messageId, type, counts: payload.reactions } })
        await client.send(new SendChannelMessageCommand({
          ChannelArn: channel.chime.channelArn,
          Content: 'REACTION',
          Type: 'STANDARD',
          Persistence: 'NON_PERSISTENT',
          Metadata: meta,
          ChimeBearer: operatorArn
        }))
      }
    } catch {}

    return res.json(payload)
  } catch (err) {
    return next(err)
  }
}

export const markChannelAsRead = async (req, res, next) => {
  try {
    const { channelId } = req.params
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))

    const user = await User.findById(req.auth.userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))

    const channel = await Channel.findById(channelId)
    if (!channel) return next(new AppError('Channel not found', 404, 'NOT_FOUND'))

    // Mark channel as read for the user
    const membership = await UnreadCountService.markAsRead(channelId, req.auth.userId)
    
    console.log('[Controller] markChannelAsRead success', { 
      channelId, 
      userId: req.auth.userId,
      previousUnreadCount: membership.unreadCount 
    })

    return res.json({ 
      success: true, 
      unreadCount: membership.unreadCount,
      lastReadAt: membership.lastReadAt 
    })
  } catch (err) {
    console.error('[Controller] markChannelAsRead error', { error: err.message, stack: err.stack })
    return next(err)
  }
}

export const getUserUnreadSummary = async (req, res, next) => {
  try {
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))

    const user = await User.findById(req.auth.userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))

    const summary = await UnreadCountService.getUserUnreadSummary(req.auth.userId)
    
    console.log('[Controller] getUserUnreadSummary success', { 
      userId: req.auth.userId,
      channelCount: summary.length,
      totalUnread: summary.reduce((sum, item) => sum + item.unreadCount, 0)
    })

    return res.json({ summary })
  } catch (err) {
    console.error('[Controller] getUserUnreadSummary error', { error: err.message, stack: err.stack })
    return next(err)
  }
}

export const getChannelUnreadCount = async (req, res, next) => {
  try {
    const { channelId } = req.params
    if (!req.auth?.userId) return next(new AppError('Unauthorized', 401, 'UNAUTHORIZED'))

    const user = await User.findById(req.auth.userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))

    const channel = await Channel.findById(channelId)
    if (!channel) return next(new AppError('Channel not found', 404, 'NOT_FOUND'))

    const unreadCount = await UnreadCountService.getUnreadCount(channelId, req.auth.userId)
    
    return res.json({ unreadCount })
  } catch (err) {
    console.error('[Controller] getChannelUnreadCount error', { error: err.message, stack: err.stack })
    return next(err)
  }
}


