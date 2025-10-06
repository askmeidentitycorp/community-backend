import Channel from '../models/Channel.js'
import Message from '../models/Message.js'
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
    const user = await User.findById(userId)
    if (!user) return next(new AppError('User not found', 404, 'NOT_FOUND'))
    const channel = await chimeMessagingService.addMember({ channelId, user })
    return res.json({ channel })
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
    const { messageId, content, createdTimestamp } = req.body || {}
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
    if (createdTimestamp) {
      const ts = new Date(createdTimestamp)
      if (!Number.isNaN(ts.getTime())) Object.assign(doc, { createdAt: ts, updatedAt: ts })
    }

    const saved = await Message.create(doc)
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
    
    // Get channels where user is a member
    const channels = await Channel.find({ 
      members: user._id,
      isArchived: { $ne: true }
    }).populate('members', 'name email').sort({ createdAt: -1 })
    
    console.log('[Controller] listChannels success', { channelCount: channels.length })
    return res.json({ channels })
  } catch (err) {
    console.error('[Controller] listChannels error', { error: err.message, stack: err.stack })
    return next(err)
  }
}


