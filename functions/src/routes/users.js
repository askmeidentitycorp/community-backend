import express from 'express';
import userController from '../controllers/userController.js';
import { validatePlatformToken } from '../middleware/auth.js';
import { requireRole, requirePermission } from '../middleware/rbac.js';
import { validate } from '../middleware/validation.js';
import Joi from 'joi';

const router = express.Router();
const activitySchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(20),
  cursor: Joi.string().optional(),
});
const searchUsersSchema = Joi.object({
  q: Joi.string().trim().min(1).max(200).required(),
  limit: Joi.number().integer().min(1).max(100).default(20),
  cursor: Joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional(),
});


// Schemas
const upsertUserSchema = Joi.object({
  auth0Id: Joi.string().required(),
  email: Joi.string().email().required(),
  name: Joi.string().min(1).max(120).required(),
  avatar: Joi.string().uri().optional(),
  roles: Joi.array().items(Joi.string().valid('member', 'moderator', 'tenant_admin')).default(['member']),
});

const updateSelfSchema = Joi.object({
  name: Joi.string().min(1).max(120),
  title: Joi.string().max(100).allow(''),
  department: Joi.string().max(100).allow(''),
  profile: Joi.object().keys({
    bio: Joi.string().max(2000).allow(''),
    location: Joi.string().max(120).allow(''),
    coverImage: Joi.string().uri().allow(''),
    skills: Joi.array().items(Joi.string()).max(50),
    socialLinks: Joi.object().pattern(/.*/, Joi.string().uri()),
  }),
  preferences: Joi.object().keys({
    theme: Joi.string().valid('light', 'dark', 'system'),
    notifications: Joi.object(),
  }),
}).min(1);

const uploadAvatarSchema = Joi.object({
  dataUrl: Joi.string().pattern(/^data:[^;]+;base64,[A-Za-z0-9+/=]+$/).required(),
});

const updateUserSchema = Joi.object({
  name: Joi.string().min(1).max(120),
  title: Joi.string().max(100).allow(''),
  department: Joi.string().max(100).allow(''),
  status: Joi.string().valid('active', 'inactive', 'suspended', 'invited'),
}).min(1);

const assignRolesSchema = Joi.object({
  roles: Joi.array().items(Joi.string().valid('member', 'moderator', 'tenant_admin')).min(1).required(),
});

const inviteUserSchema = Joi.object({
  email: Joi.string().email().required(),
  name: Joi.string().min(1).max(120).required(),
  roles: Joi.array().items(Joi.string().valid('member', 'moderator', 'tenant_admin')).default(['member']),
});

const syncUserSchema = Joi.object({
  email: Joi.string().email().required(),
});

const revokeSessionSchema = Joi.object({
  sessionId: Joi.string().required(),
});

// Routes

// Upsert user
router.post(
  '/users/upsert',
  validatePlatformToken,
  requireRole(['super_admin']),
  validate(upsertUserSchema),
  userController.upsertUser
);

// List users
router.get(
  '/users',
  validatePlatformToken,
  userController.listUsers
);

// Search users by name or email (prefix), optimized with indexes and cursor pagination
router.get(
  '/users/search',
  validatePlatformToken,
  validate(searchUsersSchema, 'query'),
  userController.searchUsers
);

// Get user by ID
router.get(
  '/users/:userId',
  validatePlatformToken,
  userController.getUser
);

// Get user avatar (binary)
router.get(
  '/users/:userId/avatar',
  validatePlatformToken,
  userController.getUserAvatar
);

// Get current user (self)
router.get(
  '/users/me',
  validatePlatformToken,
  userController.getSelf
);

// Unified activity feed (discussions + comments)
router.get(
  '/users/:userId/activity',
  validatePlatformToken,
  validate(activitySchema, 'query'),
  userController.getUserActivity
);

// Update self
router.put(
  '/users/me',
  validatePlatformToken,
  validate(updateSelfSchema),
  userController.updateSelf
);

// Upload/Update self avatar (expects small data URL, <=10KB after compression)
router.put(
  '/users/me/avatar',
  validatePlatformToken,
  validate(uploadAvatarSchema),
  userController.uploadAvatar
);

// Reset avatar to Auth0 picture
router.post(
  '/users/me/avatar/reset',
  validatePlatformToken,
  userController.resetAvatarToAuth0
);

// Update user (admin)
router.put(
  '/users/:userId',
  validatePlatformToken,
  requireRole(['super_admin']),
  validate(updateUserSchema),
  userController.updateUser
);

// Assign roles
router.post(
  '/users/:userId/roles',
  validatePlatformToken,
  requireRole(['super_admin']),
  validate(assignRolesSchema),
  userController.assignRoles
);

// Remove role
router.delete(
  '/users/:userId/roles/:role',
  validatePlatformToken,
  requireRole(['super_admin']),
  userController.removeRole
);

// Deactivate user
router.post(
  '/users/:userId/deactivate',
  validatePlatformToken,
  requireRole(['super_admin']),
  userController.deactivateUser
);

// Reactivate user
router.post(
  '/users/:userId/reactivate',
  validatePlatformToken,
  requireRole(['super_admin']),
  userController.reactivateUser
);

// Block user in Auth0
router.post(
  '/users/:userId/block',
  validatePlatformToken,
  requireRole(['super_admin']),
  userController.blockUser
);

// Unblock user in Auth0
router.post(
  '/users/:userId/unblock',
  validatePlatformToken,
  requireRole(['super_admin']),
  userController.unblockUser
);

// Invite user
router.post(
  '/users/invite',
  validatePlatformToken,
  requireRole(['super_admin']),
  validate(inviteUserSchema),
  userController.inviteUser
);

// Sync user from Auth0
router.post(
  '/users/sync',
  validatePlatformToken,
  requireRole(['super_admin']),
  validate(syncUserSchema),
  userController.syncUser
);

// Sessions

// Get sessions
router.get(
  '/auth/sessions',
  validatePlatformToken,
  userController.getSessions
);

// Revoke session
router.post(
  '/auth/sessions/revoke',
  validatePlatformToken,
  validate(revokeSessionSchema),
  userController.revokeSession
);

// Revoke all sessions
router.post(
  '/auth/sessions/revoke-all',
  validatePlatformToken,
  userController.revokeAllSessions
);

// Liked content of current user
router.get(
  '/users/me/liked/discussions',
  validatePlatformToken,
  userController.getMyLikedDiscussions
);

router.get(
  '/users/me/liked/comments',
  validatePlatformToken,
  userController.getMyLikedComments
);

export default router;
