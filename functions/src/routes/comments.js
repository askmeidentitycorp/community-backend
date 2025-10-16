import express from 'express';
import Joi from 'joi';
import multer from 'multer';
import { validate } from '../middleware/validation.js';
import { validatePlatformToken, tryValidatePlatformToken } from '../middleware/auth.js';
import { requirePermission } from '../middleware/rbac.js';
import commentController from '../controllers/commentController.js';

const router = express.Router({ mergeParams: true });

// Multer setup for image upload (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// Middleware to preprocess FormData for validation
const preprocessFormData = (req, res, next) => {
  if (req.file) {
    // No special preprocessing needed for comments
  }
  next();
};

// List comments (auth required)
router.get(
  '/discussions/:discussionId/comments',
  tryValidatePlatformToken,
  commentController.listComments
);

// Create comment (auth + permission)
router.post(
  '/discussions/:discussionId/comments',
  validatePlatformToken,
  requirePermission('comment'),
  upload.single('image'),
  preprocessFormData,
  validate(Joi.object({
    content: Joi.string().min(1).required(),
    parentId: Joi.string().optional(),
  })),
  commentController.createComment
);

// Delete comment (auth; author or elevated)
router.delete(
  '/discussions/:discussionId/comments/:commentId',
  validatePlatformToken,
  commentController.deleteComment
);

// Update comment (auth; author or elevated)
router.put(
  '/discussions/:discussionId/comments/:commentId',
  validatePlatformToken,
  validate(Joi.object({ content: Joi.string().min(1).required() })),
  commentController.updateComment
);

// Likes/Dislikes for comments
router.post(
  '/discussions/:discussionId/comments/:commentId/like',
  validatePlatformToken,
  commentController.likeComment
);

router.delete(
  '/discussions/:discussionId/comments/:commentId/like',
  validatePlatformToken,
  commentController.unlikeComment
);

router.post(
  '/discussions/:discussionId/comments/:commentId/dislike',
  validatePlatformToken,
  commentController.dislikeComment
);

router.delete(
  '/discussions/:discussionId/comments/:commentId/dislike',
  validatePlatformToken,
  commentController.undislikeComment
);

export default router;


