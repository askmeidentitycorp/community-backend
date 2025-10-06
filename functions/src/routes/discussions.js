import express from 'express';
import Joi from 'joi';
import multer from 'multer';
import discussionController from '../controllers/discussionController.js';
import { validatePlatformToken, tryValidatePlatformToken } from '../middleware/auth.js';
import { requirePermission, ROLES } from '../middleware/rbac.js';
import { validate } from '../middleware/validation.js';

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

// Multer setup for image upload (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// Middleware to preprocess FormData for validation
const preprocessFormData = (req, res, next) => {
  if (req.file) {
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
  }
  next();
};

// Routes
router.post(
  '/discussions',
  validatePlatformToken,
  requirePermission('create_discussion'),
  upload.single('image'),
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


