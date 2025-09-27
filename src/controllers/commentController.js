import { AppError } from '../utils/errorHandler.js';
import Comment from '../models/Comment.js';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';
import { uploadBufferToS3 } from '../services/mediaService.js';


class CommentController {
  async listComments(req, res, next) {
    try {
      const { discussionId } = req.params;
      let { parentId, limit = 50, offset = 0 } = req.query;

      // Normalize params
      limit = Math.min(parseInt(limit, 10) || 50, 100);
      offset = parseInt(offset, 10) || 0;

      // Build query: default to top-level (no parent)
      const query = { discussionId };
      if (parentId === undefined || parentId === 'null' || parentId === '') {
        query.$or = [ { parentId: { $exists: false } }, { parentId: null } ];
      } else {
        query.parentId = parentId;
      }

      const comments = await Comment.find(query)
        .sort({ createdAt: 1 })
        .skip(offset)
        .limit(limit)
        .lean();

      // Compute direct child counts for returned comments in a single aggregation
      const ids = comments.map(c => c._id);
      let childCounts = {};
      if (ids.length > 0) {
        const agg = await Comment.aggregate([
          { $match: { discussionId: new mongoose.Types.ObjectId(discussionId), parentId: { $in: ids } } },
          { $group: { _id: '$parentId', count: { $sum: 1 } } }
        ]);
        childCounts = agg.reduce((acc, g) => { acc[String(g._id)] = g.count; return acc; }, {});
      }

      const total = await Comment.countDocuments(query);

      // Hydrate author names in one shot
      const authorIds = Array.from(new Set(comments.map(c => String(c.authorId)))).map(id => new mongoose.Types.ObjectId(id))
      let idToUser = {}
      if (authorIds.length) {
        const users = await User.find({ _id: { $in: authorIds } }, { name: 1, roles: 1 }).lean()
        idToUser = users.reduce((acc, u) => { acc[String(u._id)] = u; return acc }, {})
      }

      return res.status(200).json({
        comments: comments.map(c => ({
          id: c._id,
          discussionId: c.discussionId,
          parentId: c.parentId,
          authorId: c.authorId,
          author: { 
            id: c.authorId, 
            name: idToUser[String(c.authorId)]?.name || 'User',
            role: Array.isArray(idToUser[String(c.authorId)]?.roles) ? (idToUser[String(c.authorId)].roles[0] || null) : null
          },
          content: c.content,
          imageUrl: c.imageUrl || '',
          likes: c.likes || [],
          likesCount: (c.likes || []).length,
          dislikesCount: (c.dislikes || []).length,
          likedByMe: req.auth?.userId ? (c.likes || []).some(u => String(u) === String(req.auth.userId)) : false,
          dislikedByMe: req.auth?.userId ? (c.dislikes || []).some(u => String(u) === String(req.auth.userId)) : false,
          isEdited: !!c.isEdited,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          replyCount: childCounts[String(c._id)] || 0,
        })),
        total,
        page: { limit, offset }
      });
    } catch (error) {
      next(error);
    }
  }

  async createComment(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const { discussionId } = req.params;
      const { content, parentId } = req.body;

      // Handle optional image upload via multipart form-data
      let imageUrl = ''
      if (req.file && req.file.buffer) {
        imageUrl = await uploadBufferToS3(req.file.buffer, {
          contentType: req.file.mimetype,
          originalName: req.file.originalname,
          prefix: 'comments/images/'
        })
      }

      const comment = new Comment({
        discussionId,
        parentId: parentId || undefined,
        authorId: req.auth.userId,
        content,
        imageUrl: imageUrl || undefined,
      });

      await comment.save();
      logger.info('Comment created', { id: comment._id.toString(), discussionId });

      return res.status(201).json({
        comment: {
          id: comment._id,
          discussionId: comment.discussionId,
          parentId: comment.parentId,
          authorId: comment.authorId,
          content: comment.content,
          imageUrl: comment.imageUrl || '',
          likes: [],
          likesCount: 0,
          dislikesCount: 0,
          isEdited: false,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteComment(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const { discussionId, commentId } = req.params;

      const comment = await Comment.findOne({ _id: commentId, discussionId });
      if (!comment) {
        throw new AppError('Comment not found', 404, 'NOT_FOUND');
      }

      const roles = req.auth.roles || [];
      const permissions = req.auth.permissions || [];
      const isElevated = roles.includes('super_admin') || roles.includes('moderator') || permissions.includes('manage_discussions');
      const isOwner = String(comment.authorId) === String(req.auth.userId);

      if (!isElevated && !isOwner) {
        return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
      }

      await Comment.deleteOne({ _id: comment._id });
      logger.info('Comment deleted', { id: comment._id.toString(), discussionId });
      return res.status(200).json({ message: 'Deleted' });
    } catch (error) {
      next(error);
    }
  }

  async likeComment(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const { discussionId, commentId } = req.params;
      const userId = req.auth.userId;

      const comment = await Comment.findOneAndUpdate(
        { _id: commentId, discussionId },
        {
          $addToSet: { likes: userId },
          $pull: { dislikes: userId }
        },
        { new: true }
      );
      if (!comment) {
        throw new AppError('Comment not found', 404, 'NOT_FOUND');
      }
      await User.updateOne({ _id: userId }, {
        $addToSet: { likedComments: comment._id },
        $pull: { dislikedComments: comment._id }
      })
      let likedByMe = false
      let dislikedByMe = false
      if (req.auth?.userId) {
        likedByMe = (comment.likes || []).some(u => String(u) === String(req.auth.userId))
        dislikedByMe = (comment.dislikes || []).some(u => String(u) === String(req.auth.userId))
      }
      return res.status(200).json({
        comment: {
          id: comment._id,
          likesCount: (comment.likes || []).length,
          dislikesCount: (comment.dislikes || []).length,
          likedByMe,
          dislikedByMe,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async unlikeComment(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const { discussionId, commentId } = req.params;
      const userId = req.auth.userId;

      const comment = await Comment.findOneAndUpdate(
        { _id: commentId, discussionId },
        { $pull: { likes: userId } },
        { new: true }
      );
      if (!comment) {
        throw new AppError('Comment not found', 404, 'NOT_FOUND');
      }
      await User.updateOne({ _id: userId }, { $pull: { likedComments: comment._id } })
      return res.status(200).json({
        comment: {
          id: comment._id,
          likesCount: (comment.likes || []).length,
          dislikesCount: (comment.dislikes || []).length,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async dislikeComment(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const { discussionId, commentId } = req.params;
      const userId = req.auth.userId;

      const comment = await Comment.findOneAndUpdate(
        { _id: commentId, discussionId },
        {
          $addToSet: { dislikes: userId },
          $pull: { likes: userId }
        },
        { new: true }
      );
      if (!comment) {
        throw new AppError('Comment not found', 404, 'NOT_FOUND');
      }
      await User.updateOne({ _id: userId }, { 
        $addToSet: { dislikedComments: comment._id },
        $pull: { likedComments: comment._id }
      })
      return res.status(200).json({
        comment: {
          id: comment._id,
          likesCount: (comment.likes || []).length,
          dislikesCount: (comment.dislikes || []).length,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async undislikeComment(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const { discussionId, commentId } = req.params;
      const userId = req.auth.userId;

      const comment = await Comment.findOneAndUpdate(
        { _id: commentId, discussionId },
        { $pull: { dislikes: userId } },
        { new: true }
      );
      if (!comment) {
        throw new AppError('Comment not found', 404, 'NOT_FOUND');
      }
      await User.updateOne({ _id: userId }, { $pull: { dislikedComments: comment._id } })
      return res.status(200).json({
        comment: {
          id: comment._id,
          likesCount: (comment.likes || []).length,
          dislikesCount: (comment.dislikes || []).length,
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new CommentController();


