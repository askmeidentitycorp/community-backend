import express from 'express';
import Joi from 'joi';
import discussionController from '../controllers/discussionController.js';
import { validatePlatformToken, tryValidatePlatformToken } from '../middleware/auth.js';
import { requirePermission, ROLES } from '../middleware/rbac.js';
import { validate } from '../middleware/validation.js';
import { logger } from '../utils/logger.js';

const router = express.Router({ mergeParams: true });

// Schemas
const createSchema = Joi.object({
  title: Joi.string().min(3).max(200).required(),
  content: Joi.string().min(1).required(),
  tags: Joi.array().items(Joi.string()).default([]),
  channelId: Joi.string().optional(),
  author: Joi.alternatives().try(
    Joi.object({
      id: Joi.string().optional(),
      name: Joi.string().optional(),
      email: Joi.string().email().optional(),
      role: Joi.string().optional(),
    }),
    Joi.string().custom((value, helpers) => {
      try {
        const parsed = JSON.parse(value);
        return typeof parsed === 'object' && parsed !== null ? parsed : helpers.error('any.invalid');
      } catch {
        return helpers.error('any.invalid');
      }
    })
  ).optional(),
});

const updateSchema = Joi.object({
  title: Joi.string().min(3).max(200),
  content: Joi.string().min(1),
  tags: Joi.array().items(Joi.string()),
  isLocked: Joi.boolean(),
  isPinned: Joi.boolean(),
}).min(1);

// Middleware to handle file uploads using express-multipart-file-parser
const handleFileUpload = (req, res, next) => {
  // Log request details for debugging
  logger.info('File upload request details', {
    contentType: req.get('Content-Type'),
    contentLength: req.get('Content-Length'),
    hasFiles: !!(req.files && req.files.length > 0),
    isMultipart: req.get('Content-Type')?.includes('multipart/form-data'),
    bodyKeys: Object.keys(req.body || {}),
    isFirebaseFunction: !!(process.env.FUNCTIONS_EMULATOR || process.env.GCLOUD_PROJECT)
  });

  // Check if files were uploaded
  if (req.files && req.files.length > 0) {
    const imageFile = req.files.find(file => file.fieldname === 'image');
    if (imageFile) {
      // Validate file type
      if (!imageFile.mimetype.startsWith('image/')) {
        return res.status(400).json({ error: { message: 'Only image files are allowed' } });
      }
      
      // Validate file size (10MB limit)
      if (imageFile.buffer.length > 10 * 1024 * 1024) {
        return res.status(400).json({ error: { message: 'File too large. Maximum size is 10MB.' } });
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
      
      logger.info('File processed successfully', {
        filename: imageFile.filename,
        mimetype: imageFile.mimetype,
        size: imageFile.buffer.length
      });
    }
  }
  
  next();
};

// Middleware to preprocess FormData for validation
const preprocessFormData = (req, res, next) => {
  // Convert FormData fields to proper format
  if (req.body.tags && !Array.isArray(req.body.tags)) {
    req.body.tags = [req.body.tags];
  }
  if (req.body.author && typeof req.body.author === 'string') {
    try {
      req.body.author = JSON.parse(req.body.author);
    } catch (e) {
      req.body.author = undefined;
    }
  }
  next();
};

// Routes
router.post(
  '/discussions',
  validatePlatformToken,
  requirePermission('create_discussion'),
  handleFileUpload,
  preprocessFormData,
  validate(createSchema),
  discussionController.createDiscussion
);

router.get(
  '/discussions',
  tryValidatePlatformToken,
  discussionController.listDiscussions
);

router.get(
  '/discussions/:discussionId',
  tryValidatePlatformToken,
  discussionController.getDiscussion
);

router.put(
  '/discussions/:discussionId',
  validatePlatformToken,
  // Moderators, admin can update; authors should also be allowed ideally
  requirePermission('manage_discussions'),
  validate(updateSchema),
  discussionController.updateDiscussion
);

router.delete(
  '/discussions/:discussionId',
  validatePlatformToken,
  requirePermission('manage_discussions'),
  discussionController.deleteDiscussion
);

// (comments moved to routes/comments.js)

// Likes/Dislikes for discussions
router.post(
  '/discussions/:discussionId/like',
  validatePlatformToken,
  discussionController.likeDiscussion
);

router.delete(
  '/discussions/:discussionId/like',
  validatePlatformToken,
  discussionController.unlikeDiscussion
);

router.post(
  '/discussions/:discussionId/dislike',
  validatePlatformToken,
  discussionController.dislikeDiscussion
);

router.delete(
  '/discussions/:discussionId/dislike',
  validatePlatformToken,
  discussionController.undislikeDiscussion
);

export default router;


