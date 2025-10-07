import express from 'express'
import multer from 'multer'
import { validatePlatformToken } from '../middleware/auth.js'
import { uploadBufferToS3Bucket2 } from '../services/mediaService.js'

const router = express.Router()

const upload = multer({ storage: multer.memoryStorage() })

router.post('/media/upload', validatePlatformToken, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' })
    }
    const url = await uploadBufferToS3Bucket2(req.file.buffer, {
      contentType: req.file.mimetype,
      originalName: req.file.originalname,
      prefix: 'chat/media/'
    })
    return res.status(201).json({ url })
  } catch (e) {
    next(e)
  }
})

export default router


