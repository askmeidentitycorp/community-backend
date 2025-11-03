import express from 'express'
import connectionController from '../controllers/connectionController.js'
import Joi from 'joi'
import { validatePlatformToken } from '../middleware/auth.js'

const router = express.Router()

router.post('/connections/request', validatePlatformToken, connectionController.requestConnection);
router.get('/connections/pending', validatePlatformToken, connectionController.getPendingConnections);
// router.get('/connections/sent', validatePlatformToken, connectionController.getsSentConnections);
router.get('/connections/received', validatePlatformToken, connectionController.getReceivedConnections);
// router.get('/connections/blocked', validatePlatformToken, connectionController.getBlockedConnections);
router.get('/connections', validatePlatformToken, connectionController.getAllConnections);
// router.get('/connections/check/:userId', validatePlatformToken, connectionController.checkConnection);
router.post('/connections/accept', validatePlatformToken, connectionController.acceptConnection);
router.post('/connections/reject', validatePlatformToken, connectionController.rejectConnection);
// router.delete('/connections/:id', validatePlatformToken, connectionController.removeConnection);

export default router;