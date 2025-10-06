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
      res.status(200).json({ message: 'getUser not implemented yet' });
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
