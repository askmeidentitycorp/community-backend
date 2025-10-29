import express from 'express';
import { getUserMentions, markMentionAsRead, markAllMentionsAsRead, getUnreadMentionCount } from '../controllers/mentionsController.js';
import { validatePlatformToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * @route GET /api/v1/mentions
 * @desc Get all mentions for authenticated user
 * @access Private
 * @query limit - Number of results to return (default: 50, max: 100)
 * @query offset - Number of results to skip (default: 0)
 * @query type - Filter by type: 'message' or 'comment' (optional)
 */
router.get('/', validatePlatformToken, getUserMentions);

/**
 * @route GET /api/v1/mentions/unread-count
 * @desc Get unread mention count for authenticated user
 * @access Private
 */
router.get('/unread-count', validatePlatformToken, getUnreadMentionCount);

/**
 * @route POST /api/v1/mentions/mark-all-read
 * @desc Mark all mentions as read
 * @access Private
 */
router.post('/mark-all-read', validatePlatformToken, markAllMentionsAsRead);

/**
 * @route POST /api/v1/mentions/:type/:mentionId/read
 * @desc Mark a mention as read
 * @access Private
 */
router.post('/:type/:mentionId/read', validatePlatformToken, markMentionAsRead);

export default router;

