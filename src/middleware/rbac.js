import { AppError } from '../utils/errorHandler.js';
import User from '../models/User.js';
import { logger } from '../utils/logger.js';
import ChannelRoleAssignment from '../models/ChannelRoleAssignment.js';

// Role definitions
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  MODERATOR: 'moderator',
  MEMBER: 'member',
};

// Permission matrix
export const PERMISSIONS = {
  [ROLES.SUPER_ADMIN]: ['*'], // Super admin can do everything
  [ROLES.MODERATOR]: [
    'moderate_discussions',
    'moderate_channels',
    'create_discussion',
    'comment',
    'upload_file',
  ],
  [ROLES.MEMBER]: ['create_discussion', 'comment', 'upload_file'],
};

/**
 * Middleware to check if user has required permission
 */
export const requirePermission = (permission) => {
  return (req, res, next) => {
    // Make sure auth middleware has run
    if (!req.auth) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    const { roles, permissions } = req.auth;

    // Super admin can do everything
    if (roles.includes(ROLES.SUPER_ADMIN)) {
      return next();
    }

    // Check if user has the specific permission
    if (permissions.includes('*') || permissions.includes(permission)) {
      return next();
    }

    // Debug log to understand missing permission issues
    logger.info('RBAC: permission denied', {
      permission,
      roles,
      permissions,
    });

    return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
  };
};

/**
 * Middleware to check if user has one of the required roles
 */
export const requireRole = (allowedRoles) => {
  return (req, res, next) => {
    // Make sure auth middleware has run
    if (!req.auth) {
      return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
    }

    const { roles } = req.auth;

    // Check if user has any of the allowed roles
    const hasRole = allowedRoles.some((role) => roles.includes(role));
    
    if (hasRole) {
      return next();
    }

    return next(new AppError('Insufficient role', 403, 'FORBIDDEN'));
  };
};

/**
 * Require SUPER_ADMIN role, but allow bootstrap if no super_admin exists yet.
 * Useful to promote the first user without preexisting admins.
 */
export const requireSuperAdminOrBootstrap = async (req, res, next) => {
  // Must be authenticated
  if (!req.auth) {
    return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
  }

  // If requester is already super admin, allow
  if ((req.auth.roles || []).includes(ROLES.SUPER_ADMIN)) {
    return next();
  }

  try {
    const count = await User.countDocuments({ roles: ROLES.SUPER_ADMIN });
    // If no super admin exists, allow bootstrap
    if (count === 1) return next();
    return next(new AppError('Insufficient role', 403, 'FORBIDDEN'));
  } catch (e) {
    return next(new AppError('Authorization check failed', 500, 'AUTHZ_ERROR'));
  }
};

/**
 * Require channel moderator role for the channel in params, or super_admin.
 * channelIdParamName allows reuse for nested routes.
 */
export const requireChannelModerator = (channelIdParamName = 'channelId') => {
  return async (req, res, next) => {
    try {
      if (!req.auth) return next(new AppError('Authentication required', 401, 'UNAUTHORIZED'));
      const { roles = [], userId } = req.auth;
      if (roles.includes(ROLES.SUPER_ADMIN)) return next();
      const channelId = req.params?.[channelIdParamName];
      if (!channelId) return next(new AppError('channelId missing in route', 400, 'VALIDATION_ERROR'));
      const exists = await ChannelRoleAssignment.exists({ channelId, userId, role: 'moderator' });
      if (exists) return next();
      return next(new AppError('Insufficient permissions', 403, 'FORBIDDEN'));
    } catch (e) {
      return next(new AppError('Authorization check failed', 500, 'AUTHZ_ERROR'));
    }
  };
};
