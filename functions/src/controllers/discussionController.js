import { AppError } from '../utils/errorHandler.js';
import Discussion from '../models/Discussion.js';
import Comment from '../models/Comment.js';
import { logger } from '../utils/logger.js';
import User from '../models/User.js';
import { uploadBufferToS3 } from '../services/mediaService.js'

class DiscussionController {
  async createDiscussion(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const { title, content, tags, channelId, author } = req.body;

      // Handle optional image upload via multipart form-data
      let imageUrl = ''
      if (req.file && req.file.buffer) {
        imageUrl = await uploadBufferToS3(req.file.buffer, {
          contentType: req.file.mimetype,
          originalName: req.file.originalname,
          prefix: 'discussions/images/'
        })
      }

      const discussion = new Discussion({
        title,
        content,
        authorId: req.auth.userId,
        tenantUserId: req.auth.tenantUserLinkId,
        tenantId: req.auth.tenantId,
        author: author && typeof author === 'object' ? {
          id: author.id,
          name: author.name,
          email: author.email,
          role: author.role,
        } : undefined,
        tags: Array.isArray(tags) ? tags : [],
        channelId: channelId || undefined,
        imageUrl: imageUrl || undefined,
      });

      await discussion.save();
      logger.info(`Discussion created ${discussion._id} by ${req.auth.userId}`);

      res.status(201).json({
        discussion: {
          id: discussion._id,
          title: discussion.title,
          content: discussion.content,
          tags: discussion.tags,
          tenantId: discussion.tenantId,
          author: discussion.author ? {
            id: discussion.author.id,
            name: discussion.author.name,
            email: discussion.author.email,
            role: discussion.author.role,
          } : undefined,
          authorId: discussion.authorId,
          channelId: discussion.channelId,
          imageUrl: discussion.imageUrl || '',
          likesCount: (discussion.likes || []).length,
          dislikesCount: (discussion.dislikes || []).length,
          createdAt: discussion.createdAt,
          updatedAt: discussion.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async listDiscussions(req, res, next) {
    try {
      const { limit = 20, offset = 0, channelId, tag, search } = req.query;

      const query = {
        tenantId: req.auth?.tenantId ,
      };
      if (channelId) query.channelId = channelId;
      if (tag) query.tags = tag;
      if (search) query.title = { $regex: search, $options: 'i' };

      const discussions = await Discussion.find(query)
        .sort({ createdAt: -1 })
        .skip(parseInt(offset, 10))
        .limit(parseInt(limit, 10))
        .lean();

      const total = await Discussion.countDocuments(query);

      // Get comment counts for all discussions (parent-level only)
      const discussionIds = discussions.map(d => d._id);
      let commentCounts = {};
      if (discussionIds.length > 0) {
        const commentAggregation = await Comment.aggregate([
          {
            $match: {
              discussionId: { $in: discussionIds },
              $or: [
                { parentId: { $exists: false } },
                { parentId: null }
              ]
            }
          },
          {
            $group: {
              _id: '$discussionId',
              count: { $sum: 1 }
            }
          }
        ]);
        commentCounts = commentAggregation.reduce((acc, item) => {
          acc[String(item._id)] = item.count;
          return acc;
        }, {});
      }

      res.status(200).json({
        discussions: discussions.map(d => ({
          id: d._id,
          title: d.title,
          content: d.content,
          tags: d.tags,
          authorId: d.authorId,
          author: d.author ? {
            id: d.author.id,
            name: d.author.name,
            email: d.author.email,
            role: d.author.role,
          } : undefined,
          channelId: d.channelId,
          imageUrl: d.imageUrl || '',
          likesCount: (d.likes || []).length,
          dislikesCount: (d.dislikes || []).length,
          likedByMe: req.auth?.userId ? (d.likes || []).some(u => String(u) === String(req.auth.userId)) : false,
          dislikedByMe: req.auth?.userId ? (d.dislikes || []).some(u => String(u) === String(req.auth.userId)) : false,
          comments: commentCounts[String(d._id)] || 0,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
        total,
      });
    } catch (error) {
      next(error);
    }
  }

  async getDiscussion(req, res, next) {
    try {
      const { discussionId } = req.params;

      const discussion = await Discussion.findOne({ _id: discussionId });
      if (!discussion) {
        throw new AppError('Discussion not found', 404, 'NOT_FOUND');
      }

      res.status(200).json({
        discussion: {
          id: discussion._id,
          title: discussion.title,
          content: discussion.content,
          tags: discussion.tags,
          author: discussion.author ? {
            id: discussion.author.id,
            name: discussion.author.name,
            email: discussion.author.email,
            role: discussion.author.role,
          } : undefined,
          authorId: discussion.authorId,
          channelId: discussion.channelId,
          imageUrl: discussion.imageUrl || '',
          likesCount: (discussion.likes || []).length,
          dislikesCount: (discussion.dislikes || []).length,
          likedByMe: req.auth?.userId ? (discussion.likes || []).some(u => String(u) === String(req.auth.userId)) : false,
          dislikedByMe: req.auth?.userId ? (discussion.dislikes || []).some(u => String(u) === String(req.auth.userId)) : false,
          createdAt: discussion.createdAt,
          updatedAt: discussion.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async updateDiscussion(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const { discussionId } = req.params;
      const { title, content, tags, isLocked, isPinned } = req.body;

      const discussion = await Discussion.findOne({ _id: discussionId });
      if (!discussion) {
        throw new AppError('Discussion not found', 404, 'NOT_FOUND');
      }

      // Allow author or admin via RBAC middleware before reaching here
      if (title !== undefined) discussion.title = title;
      if (content !== undefined) discussion.content = content;
      if (tags !== undefined) discussion.tags = Array.isArray(tags) ? tags : [];
      if (isLocked !== undefined) discussion.isLocked = !!isLocked;
      if (isPinned !== undefined) discussion.isPinned = !!isPinned;

      await discussion.save();
      logger.info(`Discussion updated ${discussion._id}`);

      res.status(200).json({
        discussion: {
          id: discussion._id,
          title: discussion.title,
          content: discussion.content,
          tags: discussion.tags,
          author: discussion.author ? {
            id: discussion.author.id,
            name: discussion.author.name,
            email: discussion.author.email,
            role: discussion.author.role,
          } : undefined,
          authorId: discussion.authorId,
          channelId: discussion.channelId,
          isLocked: discussion.isLocked,
          isPinned: discussion.isPinned,
          imageUrl: discussion.imageUrl || '',
          likesCount: (discussion.likes || []).length,
          dislikesCount: (discussion.dislikes || []).length,
          createdAt: discussion.createdAt,
          updatedAt: discussion.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteDiscussion(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const { discussionId } = req.params;
      const discussion = await Discussion.findOneAndDelete({ _id: discussionId });
      if (!discussion) {
        throw new AppError('Discussion not found', 404, 'NOT_FOUND');
      }

      logger.info(`Discussion deleted ${discussionId}`);
      res.status(200).json({ message: 'Deleted' });
    } catch (error) {
      next(error);
    }
  }

  async likeDiscussion(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const { discussionId } = req.params;
      const userId = req.auth.userId;

      const discussion = await Discussion.findOneAndUpdate(
        { _id: discussionId },
        {
          $addToSet: { likes: userId },
          $pull: { dislikes: userId }
        },
        { new: true }
      );
      if (!discussion) {
        throw new AppError('Discussion not found', 404, 'NOT_FOUND');
      }
      await User.updateOne({ _id: userId }, {
        $addToSet: { likedDiscussions: discussion._id },
        $pull: { dislikedDiscussions: discussion._id }
      })
      let likedByMe = false
      let dislikedByMe = false
      if (req.auth?.userId) {
        likedByMe = (discussion.likes || []).some(u => String(u) === String(req.auth.userId))
        dislikedByMe = (discussion.dislikes || []).some(u => String(u) === String(req.auth.userId))
      }
      return res.status(200).json({
        discussion: {
          id: discussion._id,
          likesCount: (discussion.likes || []).length,
          dislikesCount: (discussion.dislikes || []).length,
          likedByMe,
          dislikedByMe,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async unlikeDiscussion(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const { discussionId } = req.params;
      const userId = req.auth.userId;

      const discussion = await Discussion.findOneAndUpdate(
        { _id: discussionId },
        { $pull: { likes: userId } },
        { new: true }
      );
      if (!discussion) {
        throw new AppError('Discussion not found', 404, 'NOT_FOUND');
      }
      await User.updateOne({ _id: userId }, { $pull: { likedDiscussions: discussion._id } })
      return res.status(200).json({
        discussion: {
          id: discussion._id,
          likesCount: (discussion.likes || []).length,
          dislikesCount: (discussion.dislikes || []).length,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async dislikeDiscussion(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const { discussionId } = req.params;
      const userId = req.auth.userId;

      const discussion = await Discussion.findOneAndUpdate(
        { _id: discussionId },
        {
          $addToSet: { dislikes: userId },
          $pull: { likes: userId }
        },
        { new: true }
      );
      if (!discussion) {
        throw new AppError('Discussion not found', 404, 'NOT_FOUND');
      }
      await User.updateOne({ _id: userId }, { 
        $addToSet: { dislikedDiscussions: discussion._id },
        $pull: { likedDiscussions: discussion._id }
      })
      return res.status(200).json({
        discussion: {
          id: discussion._id,
          likesCount: (discussion.likes || []).length,
          dislikesCount: (discussion.dislikes || []).length,
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async undislikeDiscussion(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const { discussionId } = req.params;
      const userId = req.auth.userId;

      const discussion = await Discussion.findOneAndUpdate(
        { _id: discussionId },
        { $pull: { dislikes: userId } },
        { new: true }
      );
      if (!discussion) {
        throw new AppError('Discussion not found', 404, 'NOT_FOUND');
      }
      await User.updateOne({ _id: userId }, { $pull: { dislikedDiscussions: discussion._id } })
      return res.status(200).json({
        discussion: {
          id: discussion._id,
          likesCount: (discussion.likes || []).length,
          dislikesCount: (discussion.dislikes || []).length,
        }
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new DiscussionController();


