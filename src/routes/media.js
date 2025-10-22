import express from 'express'
import { validatePlatformToken } from '../middleware/auth.js'
import { uploadBufferToS3Bucket2WithInfo } from '../services/mediaService.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

// Middleware to handle file uploads using express-multipart-file-parser (same as discussions)
const handleFileUpload = (req, res, next) => {
  // Log request details for debugging
  logger.info('Media upload request details', {
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    hasFiles: !!(req.files && req.files.length > 0),
    isMultipart: req.get('Content-Type')?.includes('multipart/form-data'),
    bodyKeys: Object.keys(req.body || {}),
    isFirebaseFunction: !!(process.env.FUNCTIONS_EMULATOR || process.env.GCLOUD_PROJECT)
  });

  // Allowed mime types (images by prefix + selected docs/videos)
  const ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ])
  const isAllowedType = (m) => (m && (m.startsWith('image/') || ALLOWED_MIME_TYPES.has(m)))

  // Check if files were uploaded
  if (req.files && req.files.length > 0) {
    const imageFile = req.files.find(file => file.fieldname === 'file');
    if (imageFile) {
      // Validate file type via whitelist
      if (!isAllowedType(imageFile.mimetype)) {
        return res.status(400).json({ error: 'Unsupported file type' });
      }

      // Per-type size limits
      const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB
      const MAX_DOC_BYTES = 20 * 1024 * 1024;   // 20MB
      const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50MB
      const sizeLimit = imageFile.mimetype.startsWith('image/')
        ? MAX_IMAGE_BYTES
        : (imageFile.mimetype.startsWith('video/') ? MAX_VIDEO_BYTES : MAX_DOC_BYTES)
      if (imageFile.buffer.length > sizeLimit) {
        return res.status(400).json({ error: `File too large. Maximum size is ${Math.floor(sizeLimit / (1024 * 1024))}MB.` });
      }
      
      // Add file to request object in multer-compatible format
      req.file = {
        fieldname: imageFile.fieldname,
        originalname: imageFile.filename,
        encoding: imageFile.encoding,
        mimetype: imageFile.mimetype,
        buffer: imageFile.buffer,
        size: imageFile.buffer.length
      };
      
      logger.info('Media file processed successfully', {
        filename: imageFile.filename,
        mimetype: imageFile.mimetype,
        size: imageFile.buffer.length
      });
    }
  }
  
  next();
};

router.post('/media/upload', validatePlatformToken, handleFileUpload, async (req, res, next) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'No file uploaded' })
    }
    const storage = await uploadBufferToS3Bucket2WithInfo(req.file.buffer, {
      contentType: req.file.mimetype,
      originalName: req.file.originalname,
      prefix: 'chat/media/'
    })

    const kind = req.file.mimetype.startsWith('image/')
      ? 'image'
      : (req.file.mimetype.startsWith('video/') ? 'video' : 'document')
    const ext = (req.file.originalname && req.file.originalname.includes('.'))
      ? req.file.originalname.split('.').pop().toLowerCase()
      : null

    return res.status(201).json({
      url: storage.url,
      metadata: {
        kind,
        mimeType: req.file.mimetype,
        size: req.file.size,
        originalName: req.file.originalname,
        extension: ext,
        storage
      }
    })
  } catch (e) {
    next(e)
  }
})

export default router


