import Message from '../models/Message.js';
import Comment from '../models/Comment.js';
import Channel from '../models/Channel.js';
import Discussion from '../models/Discussion.js';
import User from '../models/User.js';
import { AppError } from '../utils/errorHandler.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

/**
 * Get all mentions for the authenticated user
 * Combines both message mentions (from channels) and comment mentions (from discussions)
 */
export const getUserMentions = async (req, res, next) => {
  try {
    if (!req.auth?.userId) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const userId = req.auth.userId;
    const { limit = 50, offset = 0, type } = req.query;

    const limitNum = Math.min(parseInt(limit, 10) || 50, 100);
    const offsetNum = parseInt(offset, 10) || 0;

    logger.info('Fetching mentions for user', { 
      userId, 
      userIdType: typeof userId,
      isObjectId: mongoose.Types.ObjectId.isValid(userId),
      filter: type || 'all'
    });

    const results = [];

    // Convert userId to ObjectId for proper comparison
    const userObjectId = mongoose.Types.ObjectId.isValid(userId) 
      ? new mongoose.Types.ObjectId(userId) 
      : userId;

    // Fetch message mentions (from channels) if type is not specified or is 'message'
    if (!type || type === 'message') {
      const messageMentions = await Message.find({
        mentions: userObjectId,
        isRedacted: { $ne: true }
      })
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .skip(offsetNum)
        .populate('authorId', 'name email avatar')
        .populate('channelId', 'name description')
        .lean();

      for (const msg of messageMentions) {
        results.push({
          id: msg._id,
          type: 'message',
          content: msg.content,
          createdAt: msg.createdAt,
          updatedAt: msg.updatedAt,
          author: msg.authorId ? {
            id: msg.authorId._id,
            name: msg.authorId.name,
            email: msg.authorId.email,
            avatar: msg.authorId.avatar
          } : null,
          channel: msg.channelId ? {
            id: msg.channelId._id,
            name: msg.channelId.name,
            description: msg.channelId.description
          } : null,
          messageId: msg._id,
          channelId: msg.channelId?._id
        });
      }
    }

    // Fetch comment mentions (from discussions) if type is not specified or is 'comment'
    if (!type || type === 'comment') {
      const commentMentions = await Comment.find({
        mentions: userObjectId
      })
        .sort({ createdAt: -1 })
        .limit(limitNum)
        .skip(offsetNum)
        .populate('authorId', 'name email avatar')
        .populate('discussionId', 'title')
        .lean();

      for (const comment of commentMentions) {
        results.push({
          id: comment._id,
          type: 'comment',
          content: comment.content,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
          author: comment.authorId ? {
            id: comment.authorId._id,
            name: comment.authorId.name,
            email: comment.authorId.email,
            avatar: comment.authorId.avatar
          } : null,
          discussion: comment.discussionId ? {
            id: comment.discussionId._id,
            title: comment.discussionId.title
          } : null,
          commentId: comment._id,
          discussionId: comment.discussionId?._id,
          parentId: comment.parentId
        });
      }
    }

    // Sort all results by date (most recent first)
    results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Apply pagination to combined results
    const paginatedResults = results.slice(0, limitNum);

    logger.info('User mentions fetched', {
      userId,
      userObjectId: userObjectId.toString(),
      totalCount: results.length,
      returnedCount: paginatedResults.length,
      messageCount: paginatedResults.filter(r => r.type === 'message').length,
      commentCount: paginatedResults.filter(r => r.type === 'comment').length,
      mentions: paginatedResults.map(m => ({ 
        id: m.id, 
        type: m.type,
        from: m.author?.name 
      }))
    });

    return res.status(200).json({
      mentions: paginatedResults,
      total: results.length,
      page: { limit: limitNum, offset: offsetNum }
    });
  } catch (error) {
    logger.error('Failed to fetch user mentions', { error: error.message });
    next(error);
  }
};

/**
 * Mark mention as read (optional feature for future)
 */
export const markMentionAsRead = async (req, res, next) => {
  try {
    if (!req.auth?.userId) {
      throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
    }

    const { mentionId, type } = req.params;

    // This is a placeholder for future implementation
    // You could add a 'readBy' field to track who has read each mention

    return res.status(200).json({
      success: true,
      message: 'Mention marked as read'
    });
  } catch (error) {
    logger.error('Failed to mark mention as read', { error: error.message });
    next(error);
  }
};

