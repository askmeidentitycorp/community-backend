import { AppError } from '../utils/errorHandler.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import auth0Service from '../services/auth0Service.js';
import tokenService from '../services/tokenService.js';
import sessionService from '../services/sessionService.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';
import Discussion from '../models/Discussion.js';
import Comment from '../models/Comment.js';

class UserController {
  async searchUsers(req, res, next) {
    try {
      const { q = '', limit = 20, cursor } = req.query;

      const sanitizedQuery = (q || '').toString().trim().toLowerCase();
      if (!sanitizedQuery) {
        return res.status(200).json({ users: [], nextCursor: null, total: 0 });
      }

      const baseFilter = { isActive: true, isDeleted: false };
      const paginationFilter = cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {};
      const searchFilter = {
        $or: [
          { email: { $regex: `^${escapeRegex(sanitizedQuery)}`, $options: 'i' } },
          { nameLower: { $regex: `^${escapeRegex(sanitizedQuery)}` } },
        ],
      };

      const finalFilter = { ...baseFilter, ...paginationFilter, ...searchFilter };

      const docs = await User.find(finalFilter)
        .sort({ _id: 1 })
        .limit(Math.min(Number(limit) || 20, 100))
        .select({
          email: 1,
          name: 1,
          firstName: 1,
          lastName: 1,
          profilePicture: 1,
          roles: 1,
          createdAt: 1,
        })
        .lean();

      const nextCursor = docs.length ? docs[docs.length - 1]._id : null;

      return res.status(200).json({
        users: docs.map(d => ({
          id: d._id,
          email: d.email,
          name: d.name,
          firstName: d.firstName,
          lastName: d.lastName,
          profilePicture: d.profilePicture,
          roles: d.roles,
          createdAt: d.createdAt,
        })),
        nextCursor,
        total: docs.length,
      });
    } catch (error) {
      next(error);
    }
  }
  async upsertUser(req, res, next) {
    try {
      // Minimal stub: acknowledge request
      res.status(201).json({ message: 'upsertUser not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async listUsers(req, res, next) {
    try {
      res.status(200).json({ users: [], total: 0 });
    } catch (error) {
      next(error);
    }
  }

  async getUser(req, res, next) {
    try {
      const { userId } = req.params;
      if (!userId) {
        throw new AppError('User ID is required', 400, 'BAD_REQUEST');
      }

      let user = null;
      if (mongoose.isValidObjectId(userId)) {
        user = await User.findOne({ _id: userId, isDeleted: false }).lean();
      }
      if (!user) {
        user = await User.findOne({ email: userId.toLowerCase(), isDeleted: false }).lean();
      }

      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }

      return res.status(200).json({
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          title: user.title,
          department: user.department,
          bio: user.bio,
          location: user.location,
          avatar: user.profilePicture,
          coverImage: user.coverImage,
          skills: user.skills || [],
          roles: user.roles,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getSelf(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const userId = req.auth.userId;

      let user = null;
      // 1) Primary: resolve via active Session using presented access token
      const authHeader = req.headers?.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
      if (token) {
        const session = await Session.findOne({ accessToken: token, isActive: true, accessTokenExpiresAt: { $gt: new Date() } }).lean();
        if (session && session.user) {
          user = await User.findOne({ _id: session.user, isDeleted: false }).lean();
        }
      }
      // 2) Fallback: by Mongo _id
      if (!user && mongoose.isValidObjectId(userId)) {
        user = await User.findOne({ _id: userId, isDeleted: false }).lean();
      }
      // 3) Final: by auth0Id
      if (!user && userId) {
        user = await User.findOne({ auth0Id: userId, isDeleted: false }).lean();
      }
      if (!user) {
        return res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
      }
      return res.status(200).json({
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          title: user.title,
          department: user.department,
          bio: user.bio,
          location: user.location,
          avatar: user.profilePicture,
          coverImage: user.coverImage,
          skills: user.skills || [],
          roles: user.roles,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  async getUserAvatar(req, res, next) {
    try {
      const { userId } = req.params;
      if (!userId) {
        throw new AppError('User ID is required', 400, 'BAD_REQUEST');
      }
      const user = await User.findById(userId).select('+avatarBinary +avatarContentType');
      if (!user || !user.avatarBinary || !user.avatarContentType) {
        return res.status(404).send();
      }
      res.setHeader('Content-Type', user.avatarContentType);
      res.setHeader('Cache-Control', 'private, max-age=3600');
      return res.status(200).send(user.avatarBinary);
    } catch (error) {
      next(error);
    }
  }

  async getUserActivity(req, res, next) {
    try {
      const { userId } = req.params;
      const { limit = 20, cursor } = req.query;

      if (!userId) throw new AppError('User ID is required', 400, 'BAD_REQUEST');

      const lim = Math.min(Number(limit) || 20, 100);
      const authorFilter = { authorId: userId };
      const createdAtCursor = cursor ? new Date(cursor) : null;
      const baseSort = { createdAt: -1 };

      const discussionQuery = Discussion.find(
        createdAtCursor ? { ...authorFilter, createdAt: { $lt: createdAtCursor } } : authorFilter
      )
        .sort(baseSort)
        .limit(lim)
        .lean();

      const commentQuery = Comment.find(
        createdAtCursor ? { ...authorFilter, createdAt: { $lt: createdAtCursor } } : authorFilter
      )
        .sort(baseSort)
        .limit(lim)
        .lean();

      const [discussions, comments] = await Promise.all([discussionQuery, commentQuery]);

      const items = [
        ...discussions.map(d => ({
          type: 'post',
          id: d._id,
          createdAt: d.createdAt,
          data: {
            discussionId: d._id,
            title: d.title,
            tags: d.tags,
            likesCount: (d.likes || []).length,
            dislikesCount: (d.dislikes || []).length,
          },
        })),
        ...comments.map(c => ({
          type: 'comment',
          id: c._id,
          createdAt: c.createdAt,
          data: {
            discussionId: c.discussionId,
            content: c.content,
            likesCount: (c.likes || []).length,
            dislikesCount: (c.dislikes || []).length,
          },
        })),
      ]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, lim);

      const nextCursor = items.length ? items[items.length - 1].createdAt : null;
      return res.status(200).json({ items, nextCursor, total: items.length });
    } catch (error) {
      next(error);
    }
  }

  async updateSelf(req, res, next) {
    try {
      const { name, profile, preferences } = req.body;
      
      // Get user ID from token
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      
      const userId = req.auth.userId;
      
      const user = await User.findOne({ 
        _id: userId,
      });
      
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }
      
      // Update fields
      if (name) user.name = name;
      
      // Update profile (if provided)
      if (profile) {
        user.profile = {
          ...(user.profile || {}),
          ...profile,
        };
      }
      
      // Update preferences (if provided)
      if (preferences) {
        user.preferences = {
          ...(user.preferences || {}),
          ...preferences,
        };
      }
      
      await user.save();
      logger.info(`User self-update: ${userId}`);
      
      res.status(200).json({
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.avatar,
        profile: user.profile,
        preferences: user.preferences,
        roles: user.roles,
        status: user.status,
        updatedAt: user.updatedAt,
      });
    } catch (error) {
      next(error);
    }
  }

  async uploadAvatar(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const userId = req.auth.userId;
      const { dataUrl } = req.body;
      const match = /^data:(.+);base64,(.*)$/.exec(dataUrl || '');
      if (!match) {
        throw new AppError('Invalid data URL', 400, 'BAD_REQUEST');
      }
      const contentType = match[1];
      const base64 = match[2];
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length > 10 * 1024) {
        throw new AppError('Avatar too large (>10KB) after compression', 413, 'PAYLOAD_TOO_LARGE');
      }

      const user = await User.findOne({ _id: userId });
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }
      user.avatarBinary = buffer;
      user.avatarContentType = contentType;
      user.profilePicture = '';
      await user.save();
      return res.status(200).json({ success: true });
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req, res, next) {
    try {
      res.status(200).json({ message: 'updateUser not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async assignRoles(req, res, next) {
    try {
      res.status(200).json({ message: 'assignRoles not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async removeRole(req, res, next) {
    try {
      res.status(200).json({ message: 'removeRole not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async deactivateUser(req, res, next) {
    try {
      res.status(200).json({ message: 'deactivateUser not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async reactivateUser(req, res, next) {
    try {
      res.status(200).json({ message: 'reactivateUser not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async blockUser(req, res, next) {
    try {
      res.status(200).json({ message: 'blockUser not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async unblockUser(req, res, next) {
    try {
      res.status(200).json({ message: 'unblockUser not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async inviteUser(req, res, next) {
    try {
      res.status(200).json({ message: 'inviteUser not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async syncUser(req, res, next) {
    try {
      res.status(200).json({ message: 'syncUser not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async getSessions(req, res, next) {
    try {
      res.status(200).json({ sessions: [] });
    } catch (error) {
      next(error);
    }
  }

  async revokeSession(req, res, next) {
    try {
      res.status(200).json({ message: 'revokeSession not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async revokeAllSessions(req, res, next) {
    try {
      res.status(200).json({ message: 'revokeAllSessions not implemented yet' });
    } catch (error) {
      next(error);
    }
  }

  async getMyLikedDiscussions(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const userId = req.auth.userId;
      const user = await User.findById(userId, { likedDiscussions: 1 }).lean();
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }
      const ids = user.likedDiscussions || [];
      if (!ids.length) return res.status(200).json({ discussions: [], total: 0 });
      const discussions = await Discussion.find({ _id: { $in: ids } }).sort({ createdAt: -1 }).lean();
      return res.status(200).json({
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
          likesCount: (d.likes || []).length,
          dislikesCount: (d.dislikes || []).length,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt,
        })),
        total: discussions.length,
      });
    } catch (error) {
      next(error);
    }
  }

  async getMyLikedComments(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const userId = req.auth.userId;
      const user = await User.findById(userId, { likedComments: 1 }).lean();
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }
      const ids = user.likedComments || [];
      if (!ids.length) return res.status(200).json({ comments: [], total: 0 });
      const comments = await Comment.find({ _id: { $in: ids } }).sort({ createdAt: -1 }).lean();
      return res.status(200).json({
        comments: comments.map(c => ({
          id: c._id,
          discussionId: c.discussionId,
          parentId: c.parentId,
          authorId: c.authorId,
          content: c.content,
          likesCount: (c.likes || []).length,
          dislikesCount: (c.dislikes || []).length,
          isEdited: !!c.isEdited,
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
        })),
        total: comments.length,
      });
    } catch (error) {
      next(error);
    }
  }
}

export default new UserController();

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}
