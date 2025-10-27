import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import User from '../models/User.js';
import Session from '../models/Session.js';
import { redisClient } from '../config/redis.js';

/**
 * Service for handling JWT tokens
 */
class TokenService {
  /**
   * Generate access token
   */
  generateAccessToken(payload) {
    const secret = process.env.JWT_SECRET;
    const ttl = parseInt(process.env.JWT_ACCESS_TTL || '3600', 10);
    logger.info('TokenService: generating access token', { ttl });
    
    return jwt.sign(
      { ...payload, type: 'access', version: 1 },
      secret,
      { expiresIn: ttl }
    );
  }

  /**
   * Generate refresh token
   */
  generateRefreshToken(payload) {
    const secret = process.env.JWT_SECRET;
    const ttl = parseInt(process.env.JWT_REFRESH_TTL || '604800', 10);
    logger.info('TokenService: generating refresh token', { ttl });
    
    return jwt.sign(
      { ...payload, type: 'refresh', version: 1 },
      secret,
      { expiresIn: ttl }
    );
  }

  /**
   * Verify token
   */
  verifyToken(token) {
    const secret = process.env.JWT_SECRET;
    
    try {
      return jwt.verify(token, secret);
    } catch (error) {
      logger.error('Token verification failed:', error);
      return null;
    }
  }

  /**
   * Create a new session and issue tokens
   */
  async createSession(userId, deviceInfo, auth0Token = null, auth0Subject = null, auth0RefreshToken = null) {
    try {
      logger.info('TokenService: createSession start', { userId });
      // Get user roles and permissions
      const user = await User.findOne({ _id: userId });
      if (!user) {
        throw new Error('User not found');
      }

      // Generate session ID
      const sessionId = uuidv4();
      logger.info('TokenService: new session id', { sessionId });
      
      // Create token payload
      const payload = {
        user_id: user._id,
        email: user.email,
        name: user.name,
        roles: Array.isArray(user.roles) ? user.roles : [],
        iat: Math.floor(Date.now() / 1000),
        type: 'access'
      };
      
      const refreshPayload = {
        user_id: user._id,
        iat: Math.floor(Date.now() / 1000),
        type: 'refresh'
      };
      
      // Generate tokens
      const accessToken = this.generateAccessToken(payload);
      const refreshToken = this.generateRefreshToken(refreshPayload);
      logger.info('TokenService: tokens created');
      
      // Calculate expiry times
      const accessTtl = parseInt(process.env.JWT_ACCESS_TOKEN_LIFETIME || '3600', 10);
      const refreshTtl = parseInt(process.env.JWT_REFRESH_TOKEN_LIFETIME || '604800', 10);
      
      const accessExpiresAt = new Date();
      accessExpiresAt.setSeconds(accessExpiresAt.getSeconds() + accessTtl);
      
      const refreshExpiresAt = new Date();
      refreshExpiresAt.setSeconds(refreshExpiresAt.getSeconds() + refreshTtl);
      
      // Save session to DB
      const session = new Session({
        sessionId,
        user: user._id,
        accessToken,
        refreshToken,
        accessTokenExpiresAt: accessExpiresAt,
        refreshTokenExpiresAt: refreshExpiresAt,
        deviceInfo: {
          userAgent: deviceInfo.userAgent,
          ip: deviceInfo.ip,
        },
        ipAddress: deviceInfo.ip,
        auth0Token,
        auth0Subject,
        auth0RefreshToken,
        isAuth0Session: !!auth0Token,
      });
      
      await session.save();
      logger.info('TokenService: session saved', { sessionId: session._id.toString() });
      
      // Update user's lastLogin
      await User.updateOne(
        { _id: userId },
        { $set: { lastLogin: new Date() } }
      );
      logger.info('TokenService: user lastLogin updated', { userId });
      
      return {
        accessToken,
        refreshToken,
        sessionId: session.sessionId,
      };
    } catch (error) {
      logger.error('TokenService: failed to create session', { error: error?.message });
      throw new Error('Failed to create session');
    }
  }

  /**
   * Revoke a session
   */
  async revokeSession(sessionId) {
    try {
      logger.info('TokenService: revokeSession', { sessionId });
      const result = await Session.updateOne(
        { sessionId },
        { $set: { isActive: false } }
      );
      
      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('Failed to revoke session:', error);
      return false;
    }
  }

  /**
   * Revoke all sessions for a user except current
   */
  async revokeAllSessions(userId, currentSessionId) {
    try {
      logger.info('TokenService: revokeAllSessions', { userId, currentSessionId });
      const query = { user: userId, isActive: true };
      if (currentSessionId) {
        query._id = { $ne: currentSessionId };
      }
      
      const result = await Session.updateMany(
        query,
        { $set: { isActive: false } }
      );
      
      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('Failed to revoke all sessions:', error);
      return false;
    }
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      logger.info('TokenService: refreshAccessToken start');
      // Verify refresh token
      const decoded = this.verifyToken(refreshToken);
      if (!decoded || decoded.type !== 'refresh') {
        logger.warn('TokenService: invalid refresh token');
        return null;
      }
      
      // Check if session is still active and refresh token not expired
      const session = await Session.findOne({ 
        refreshToken,
        isActive: true,
        refreshTokenExpiresAt: { $gt: new Date() }
      });
      
      if (!session) {
        logger.warn('TokenService: session not found or inactive');
        return null;
      }
      
      // Update session last used time
      await Session.updateOne(
        { _id: session._id },
        { $set: { lastUsedAt: new Date() } }
      );
      
      // Get updated user info
      const user = await User.findOne({ 
        _id: decoded.user_id
      });
      
      if (!user) {
        logger.warn('TokenService: user not found for refresh');
        return null;
      }
      
      // Create new payload - MUST include roles for RBAC to work!
      const payload = {
        user_id: user._id,
        email: user.email,
        name: user.name,
        roles: Array.isArray(user.roles) ? user.roles : [],
        iat: Math.floor(Date.now() / 1000),
        type: 'access'
      };
      
      // Generate new access token
      const newAccessToken = this.generateAccessToken(payload);
      logger.info('TokenService: new access token generated', { 
        userId: user._id, 
        roles: payload.roles,
        hasRoles: payload.roles.length > 0 
      });
      
      // Update session with new access token
      const accessTtl = parseInt(process.env.JWT_ACCESS_TOKEN_LIFETIME || '3600', 10);
      const accessExpiresAt = new Date();
      accessExpiresAt.setSeconds(accessExpiresAt.getSeconds() + accessTtl);
      
      await Session.updateOne(
        { _id: session._id },
        { 
          $set: { 
            accessToken: newAccessToken,
            accessTokenExpiresAt: accessExpiresAt
          } 
        }
      );
      logger.info('TokenService: session updated with new access token', { sessionId: session._id.toString() });
      
      return newAccessToken;
    } catch (error) {
      logger.error('TokenService: failed to refresh access token', { error: error?.message });
      return null;
    }
  }
}

export default new TokenService();
