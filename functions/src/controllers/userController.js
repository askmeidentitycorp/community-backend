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

      // Build efficient prefix queries using indexed fields
      // Use compound filter to only return active, non-deleted users
      const baseFilter = { isActive: true, isDeleted: false };

      // We will paginate using a cursor based on _id for stable ordering
      const paginationFilter = cursor ? { _id: { $gt: new mongoose.Types.ObjectId(cursor) } } : {};

      // Match either email prefix or nameLower prefix
      // Using $or with anchored regexes leverages index prefix and remains efficient for high volume
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

  async getSelf(req, res, next) {
    try {
      const hasAuthHeader = !!(req.headers && req.headers.authorization);
      logger.info('UserController.getSelf: start', {
        hasAuthHeader,
        authPresent: !!req.auth,
      });

      if (!req.auth) {
        logger.warn('UserController.getSelf: missing req.auth');
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const userId = req.auth.userId;
      logger.info('UserController.getSelf: resolved userId from token', { userId });

      let user = null;
      let identifierTried = userId;

      // 1) Primary: resolve via active Session using presented access token
      const authHeader = req.headers?.authorization || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
      if (token) {
        const session = await Session.findOne({ accessToken: token, isActive: true, accessTokenExpiresAt: { $gt: new Date() } }).lean();
        if (session && session.user) {
          identifierTried = session.user;
          user = await User.findOne({ _id: session.user, isDeleted: false }).lean();
        }
      }

      // 2) Fallback: by Mongo _id when token carries an ObjectId
      if (!user && mongoose.isValidObjectId(userId)) {
        identifierTried = userId;
        user = await User.findOne({ _id: userId, isDeleted: false }).lean();
      }

      // 3) Final: external subject identifiers stored as auth0Id
      if (!user && userId) {
        identifierTried = userId;
        user = await User.findOne({ auth0Id: userId, isDeleted: false }).lean();
      }
      if (!user) {
        logger.warn('UserController.getSelf: user not found for identifier', { identifier: identifierTried });
        return res.status(404).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found', identifier: String(identifierTried || '') } });
      }
      logger.info('UserController.getSelf: user loaded', { id: user._id.toString(), email: user.email });
      // Prepare optional avatar data URL (kept small; avatarBinary is <=10KB by our contract)
      let avatarDataUrl;
      try {
        const avatarDoc = await User.findById(user._id).select('+avatarBinary +avatarContentType').lean();
        if (avatarDoc?.avatarBinary && avatarDoc?.avatarContentType) {
          const base64 = Buffer.from(avatarDoc.avatarBinary).toString('base64');
          avatarDataUrl = `data:${avatarDoc.avatarContentType};base64,${base64}`;
        }
      } catch {}
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
          avatarDataUrl,
          coverImage: user.coverImage,
          skills: user.skills || [],
          roles: user.roles,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
      });
    } catch (error) {
      logger.error('UserController.getSelf: error', { message: error?.message, code: error?.code });
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
        // Allow lookup by email as a fallback if not an ObjectId
        user = await User.findOne({ email: userId.toLowerCase(), isDeleted: false }).lean();
      }

      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }

      // Include optional avatar data URL
      let avatarDataUrl;
      try {
        const avatarDoc = await User.findById(user._id).select('+avatarBinary +avatarContentType').lean();
        if (avatarDoc?.avatarBinary && avatarDoc?.avatarContentType) {
          const base64 = Buffer.from(avatarDoc.avatarBinary).toString('base64');
          avatarDataUrl = `data:${avatarDoc.avatarContentType};base64,${base64}`;
        }
      } catch {}
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
          avatarDataUrl,
          roles: user.roles,
          analytics: {
            profileViews: 0,
            postImpressions: 0,
            searchAppearances: 0,
          },
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
      
      // Select all avatar-related fields
      const user = await User.findById(userId).select('+avatarBinary +avatarContentType avatarSource auth0Picture profilePicture');
      
      if (!user) {
        return res.status(404).send();
      }
      
      // Priority 1: Uploaded binary avatar
      if (user.avatarBinary && user.avatarContentType) {
        res.setHeader('Content-Type', user.avatarContentType);
        res.setHeader('Cache-Control', 'private, max-age=3600');
        return res.status(200).send(user.avatarBinary);
      }
      
      // Priority 2: Auth0 picture (redirect to external URL)
      if (user.avatarSource === 'auth0' && user.auth0Picture) {
        return res.redirect(302, user.auth0Picture);
      }
      
      // Priority 3: Legacy profilePicture (redirect to external URL)
      if (user.profilePicture) {
        return res.redirect(302, user.profilePicture);
      }
      
      // No avatar available
      return res.status(404).send();
    } catch (error) {
      next(error);
    }
  }

  async updateSelf(req, res, next) {
    try {
      const { name, title, department, profile, preferences } = req.body;
      
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
      
      // Update top-level editable fields
      if (name) user.name = name; // kept for future admin control; route ensures self-only edits
      if (title !== undefined) user.title = title;
      if (department !== undefined) user.department = department;
      
      // Update profile (if provided)
      if (profile) {
        const { bio, location, coverImage, skills, socialLinks } = profile;
        if (bio !== undefined) user.bio = bio;
        if (location !== undefined) user.location = location;
        if (coverImage !== undefined) user.coverImage = coverImage;
        if (Array.isArray(skills)) user.skills = skills;
        // Persist socialLinks inside a nested profile object if needed later
        user.profile = { ...(user.profile || {}), ...(socialLinks ? { socialLinks } : {}) };
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
        avatar: user.profilePicture,
        title: user.title,
        department: user.department,
        bio: user.bio,
        location: user.location,
        coverImage: user.coverImage,
        skills: user.skills,
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
      // dataUrl format: data:image/png;base64,AAAA
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
      
      // Store binary avatar and update source
      user.avatarBinary = buffer;
      user.avatarContentType = contentType;
      user.avatarSource = 'uploaded';
      // Clear profilePicture URL since we're now using binary storage
      user.profilePicture = '';
      
      await user.save();
      
      logger.info('Avatar uploaded', { 
        userId: user._id.toString(), 
        avatarSource: user.avatarSource,
        binarySize: buffer.length 
      });
      
      return res.status(200).json({ 
        success: true,
        avatarUrl: `/api/v1/users/${user._id}/avatar`,
        avatarSource: 'uploaded'
      });
    } catch (error) {
      next(error);
    }
  }

  // Reset avatar back to Auth0 picture
  async resetAvatarToAuth0(req, res, next) {
    try {
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      const userId = req.auth.userId;

      const user = await User.findOne({ _id: userId });
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }

      if (!user.auth0Picture) {
        throw new AppError('No Auth0 profile picture available', 400, 'NO_AUTH0_PICTURE');
      }

      // Reset to Auth0 picture
      user.avatarSource = 'auth0';
      user.profilePicture = user.auth0Picture;
      // Clear binary data
      user.avatarBinary = undefined;
      user.avatarContentType = undefined;
      
      await user.save();
      
      logger.info('Avatar reset to Auth0', { 
        userId: user._id.toString(), 
        avatarSource: user.avatarSource,
        auth0Picture: user.auth0Picture
      });
      
      return res.status(200).json({ 
        success: true,
        avatarUrl: user.auth0Picture,
        avatarSource: 'auth0'
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req, res, next) {
    try {
      const { userId } = req.params;
      const { name, title, department, status } = req.body;
      
      if (!userId) {
        throw new AppError('User ID is required', 400, 'BAD_REQUEST');
      }

      // Find the user
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }

      // Update user fields
      if (name) user.name = name;
      if (title !== undefined) user.title = title;
      if (department !== undefined) user.department = department;
      if (status) user.status = status;

      await user.save();
      logger.info(`User updated by admin: ${userId}`, { 
        updatedFields: { name, title, department, status },
        roles: user.roles 
      });

      return res.status(200).json({
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.profilePicture,
        title: user.title,
        department: user.department,
        roles: user.roles,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (error) {
      next(error);
    }
  }

  async assignRoles(req, res, next) {
    try {
      const { userId } = req.params;
      const { roles } = req.body;
      
      if (!userId) {
        throw new AppError('User ID is required', 400, 'BAD_REQUEST');
      }

      if (!roles || !Array.isArray(roles) || roles.length === 0) {
        throw new AppError('Roles array is required', 400, 'BAD_REQUEST');
      }

      // Find the user
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }

      // Store previous roles to check if user is becoming a super_admin or losing it
      const previousRoles = user.roles || [];
      const wasSuperAdmin = previousRoles.includes('super_admin');
      const willBeSuperAdmin = roles.includes('super_admin');
      const isBecomingSuperAdmin = willBeSuperAdmin && !wasSuperAdmin;
      const isLosingSuperAdmin = wasSuperAdmin && !willBeSuperAdmin;

      // Replace roles entirely (assignRoles sets the complete role list)
      user.roles = roles;
      await user.save();
      logger.info(`Roles assigned to user: ${userId}`, { 
        previousRoles, 
        newRoles: roles 
      });

      // If the user is becoming a super_admin, promote them to AppInstanceAdmin in Chime
      if (isBecomingSuperAdmin) {
        try {
          const chimeMessagingService = (await import('../services/chimeMessagingService.js')).default;
          await chimeMessagingService.promoteToAppInstanceAdmin(user);
          logger.info('User promoted to AppInstanceAdmin in Chime', { 
            userId: user._id, 
            userName: user.name,
            newRoles: roles 
          });
        } catch (chimeError) {
          // Log the error but don't fail the role assignment
          logger.error('Failed to promote user to AppInstanceAdmin in Chime', { 
            userId: user._id, 
            error: chimeError.message 
          });
        }
      }

      // If the user is losing super_admin role, they've already been removed from AppInstanceAdmin
      // (We don't actively demote them, as that would require additional Chime API calls)
      if (isLosingSuperAdmin) {
        logger.info('User lost super_admin role', { 
          userId: user._id, 
          userName: user.name,
          previousRoles,
          newRoles: roles 
        });
      }

      return res.status(200).json({
        id: user._id,
        email: user.email,
        name: user.name,
        avatar: user.profilePicture,
        title: user.title,
        department: user.department,
        roles: user.roles,
        status: user.status,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
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

      // Also include liked/disliked discussions and comments using user model references
      const userDoc = await User.findOne({ _id: userId }, { likedDiscussions: 1, dislikedDiscussions: 1, likedComments: 1, dislikedComments: 1 }).lean();

      const likedDiscussionIds = (userDoc?.likedDiscussions || []).slice(0, lim);
      const dislikedDiscussionIds = (userDoc?.dislikedDiscussions || []).slice(0, lim);
      const likedCommentIds = (userDoc?.likedComments || []).slice(0, lim);
      const dislikedCommentIds = (userDoc?.dislikedComments || []).slice(0, lim);

      const likedDiscussionsQuery = likedDiscussionIds.length
        ? Discussion.find({ _id: { $in: likedDiscussionIds } }).sort(baseSort).limit(lim).lean()
        : Promise.resolve([]);
      const dislikedDiscussionsQuery = dislikedDiscussionIds.length
        ? Discussion.find({ _id: { $in: dislikedDiscussionIds } }).sort(baseSort).limit(lim).lean()
        : Promise.resolve([]);
      const likedCommentsQuery = likedCommentIds.length
        ? Comment.find({ _id: { $in: likedCommentIds } }).sort(baseSort).limit(lim).lean()
        : Promise.resolve([]);
      const dislikedCommentsQuery = dislikedCommentIds.length
        ? Comment.find({ _id: { $in: dislikedCommentIds } }).sort(baseSort).limit(lim).lean()
        : Promise.resolve([]);

      const [discussions, comments, likedDiscussions, dislikedDiscussions, likedComments, dislikedComments] = await Promise.all([
        discussionQuery,
        commentQuery,
        likedDiscussionsQuery,
        dislikedDiscussionsQuery,
        likedCommentsQuery,
        dislikedCommentsQuery,
      ]);

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
        ...likedDiscussions.map(d => ({
          type: 'like_discussion',
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
        ...dislikedDiscussions.map(d => ({
          type: 'dislike_discussion',
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
        ...likedComments.map(c => ({
          type: 'like_comment',
          id: c._id,
          createdAt: c.createdAt,
          data: {
            discussionId: c.discussionId,
            content: c.content,
            likesCount: (c.likes || []).length,
            dislikesCount: (c.dislikes || []).length,
          },
        })),
        ...dislikedComments.map(c => ({
          type: 'dislike_comment',
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
}

export default new UserController();

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
