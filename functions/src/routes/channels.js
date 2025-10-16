import express from 'express'
import { validatePlatformToken } from '../middleware/auth.js'
import { requireRole, ROLES, requireChannelModerator } from '../middleware/rbac.js'
import { createChannel, addMember, removeMember, listMessages, sendMessage, getChannel, ensureGeneralAndJoin, listChannels, mirrorMessage, reactToMessage, unreactToMessage, grantChannelModerator, revokeChannelModerator, listChannelModerators, deleteChannel, deleteChannelMessage } from '../controllers/channelController.js'

const router = express.Router()

// Test route to verify mounting
router.get('/channels/test', (req, res) => {
  res.json({ message: 'Channels route is working!' })
})

// Channels CRUD (minimal for now)
router.get('/channels', validatePlatformToken, listChannels)
router.post('/channels', validatePlatformToken, requireRole([ROLES.SUPER_ADMIN]), createChannel)
router.get('/channels/:channelId', validatePlatformToken, getChannel)
router.delete('/channels/:channelId', validatePlatformToken, requireRole([ROLES.SUPER_ADMIN]), deleteChannel)
router.post('/channels/:channelId/members', validatePlatformToken, requireChannelModerator('channelId'), addMember)
router.delete('/channels/:channelId/members', validatePlatformToken, requireChannelModerator('channelId'), removeMember)
router.post('/channels/general/ensure', validatePlatformToken, ensureGeneralAndJoin)

// Channel messages
router.get('/channels/:channelId/messages', validatePlatformToken, listMessages)
router.post('/channels/:channelId/messages', validatePlatformToken, sendMessage)
router.delete('/channels/:channelId/messages', validatePlatformToken, requireChannelModerator('channelId'), deleteChannelMessage)
router.post('/channels/:channelId/messages/mirror', validatePlatformToken, mirrorMessage)
router.post('/channels/:channelId/messages/react', validatePlatformToken, reactToMessage)
router.post('/channels/:channelId/messages/unreact', validatePlatformToken, unreactToMessage)

// Channel moderator list (authenticated users)
router.get('/channels/:channelId/moderators', validatePlatformToken, listChannelModerators)
router.post('/channels/:channelId/moderators', validatePlatformToken, requireRole([ROLES.SUPER_ADMIN]), grantChannelModerator)
router.delete('/channels/:channelId/moderators/:userId', validatePlatformToken, requireRole([ROLES.SUPER_ADMIN]), revokeChannelModerator)

export default router


