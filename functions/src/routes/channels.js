import express from 'express'
import { validatePlatformToken } from '../middleware/auth.js'
import { requireRole, ROLES } from '../middleware/rbac.js'
import { createChannel, addMember, removeMember, listMessages, sendMessage, getChannel, ensureGeneralAndJoin, listChannels, mirrorMessage, reactToMessage, unreactToMessage } from '../controllers/channelController.js'

const router = express.Router()

// Test route to verify mounting
router.get('/channels/test', (req, res) => {
  res.json({ message: 'Channels route is working!' })
})

// Channels CRUD (minimal for now)
router.get('/channels', validatePlatformToken, listChannels)
router.post('/channels', validatePlatformToken, requireRole([ROLES.SUPER_ADMIN]), createChannel)
router.get('/channels/:channelId', validatePlatformToken, getChannel)
router.post('/channels/:channelId/members', validatePlatformToken, addMember)
router.delete('/channels/:channelId/members', validatePlatformToken, removeMember)
router.post('/channels/general/ensure', validatePlatformToken, ensureGeneralAndJoin)

// Channel messages
router.get('/channels/:channelId/messages', validatePlatformToken, listMessages)
router.post('/channels/:channelId/messages', validatePlatformToken, sendMessage)
router.post('/channels/:channelId/messages/mirror', validatePlatformToken, mirrorMessage)
router.post('/channels/:channelId/messages/react', validatePlatformToken, reactToMessage)
router.post('/channels/:channelId/messages/unreact', validatePlatformToken, unreactToMessage)

export default router


