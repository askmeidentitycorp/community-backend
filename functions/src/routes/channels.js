import express from 'express'
import { validatePlatformToken } from '../middleware/auth.js'
import { createChannel, addMember, listMessages, sendMessage, getChannel, ensureGeneralAndJoin, listChannels, mirrorMessage } from '../controllers/channelController.js'

const router = express.Router()

// Test route to verify mounting
router.get('/channels/test', (req, res) => {
  res.json({ message: 'Channels route is working!' })
})

// Channels CRUD (minimal for now)
router.get('/channels', validatePlatformToken, listChannels)
router.post('/channels', validatePlatformToken, createChannel)
router.get('/channels/:channelId', validatePlatformToken, getChannel)
router.post('/channels/:channelId/members', validatePlatformToken, addMember)
router.post('/channels/general/ensure', validatePlatformToken, ensureGeneralAndJoin)

// Channel messages
router.get('/channels/:channelId/messages', validatePlatformToken, listMessages)
router.post('/channels/:channelId/messages', validatePlatformToken, sendMessage)
router.post('/channels/:channelId/messages/mirror', validatePlatformToken, mirrorMessage)

export default router


