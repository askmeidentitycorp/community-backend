import express from 'express'
import { validatePlatformToken } from '../middleware/auth.js'
import { uploadBufferToS3Bucket2 } from '../services/mediaService.js'
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

  // Check if files were uploaded
  if (req.files && req.files.length > 0) {
    const imageFile = req.files.find(file => file.fieldname === 'file');
    if (imageFile) {
      // Validate file type
      if (!imageFile.mimetype.startsWith('image/')) {
        return res.status(400).json({ error: 'Only image files are allowed' });
      }
      
      // Validate file size (10MB limit)
      if (imageFile.buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
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


