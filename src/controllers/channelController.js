import Channel from '../models/Channel.js'
import Message from '../models/Message.js'
import mongoose from 'mongoose'
import User from '../models/User.js'
import chimeMessagingService from '../services/chimeMessagingService.js'
import { AppError } from '../utils/errorHandler.js'

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
    const channel = await chimeMessagingService.createChannel({ name, description, isPrivate, createdByUser: creator, isDefaultGeneral })
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
    const updated = await Channel.findById(channelId)
    return res.json({ channel: updated })
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
    
    // Add metadata if provided
    if (metadata) {
      doc.metadata = metadata
    }
    
    if (createdTimestamp) {
      const ts = new Date(createdTimestamp)
      if (!Number.isNaN(ts.getTime())) Object.assign(doc, { createdAt: ts, updatedAt: ts })
    }

    const saved = await Message.create(doc)
    try {
      const dbName = mongoose?.connection?.db?.databaseName
      const coll = Message?.collection?.collectionName
      console.log('[Controller] mirrorMessage saved', { id: saved?._id, dbName, collection: coll })
    } catch {}
    return res.status(201).json({ message: saved })
  } catch (err) {
    return next(err)
  }
}

export const getChannel = async (req, res, next) => {
  try {
    const { channelId } = req.params
    const channel = await Channel.findById(channelId)
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

    // Sort: general first, then by name
    merged.sort((a, b) => {
      if (a.isDefaultGeneral) return -1
      if (b.isDefaultGeneral) return 1
      return String(a.name || '').localeCompare(String(b.name || ''))
    })

    console.log('[Controller] listChannels success', { channelCount: merged.length })
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


