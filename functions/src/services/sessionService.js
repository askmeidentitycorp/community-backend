import { redisClient } from '../config/redis.js';
import Session from '../models/Session.js';
import { logger } from '../utils/logger.js';
import mongoose from 'mongoose';

/**
 * Service for managing user sessions
 */
class SessionService {
  /**
   * Get active sessions for a user
   */
  async getUserSessions(userId) {
    try {
      // Convert string to ObjectId if needed
      const userObjectId = typeof userId === 'string' 
        ? new mongoose.Types.ObjectId(userId)
        : userId;
      
      const sessions = await Session.find({
        user: userObjectId,
        isActive: true,
      }).sort({ lastUsedAt: -1 });
      
      return sessions.map(session => ({
        id: session._id,
        createdAt: session.createdAt,
        lastUsedAt: session.lastUsedAt,
        device: session.deviceInfo,
        expiresAt: session.accessTokenExpiresAt,
      }));
    } catch (error) {
      logger.error('Failed to get user sessions:', error);
      return [];
    }
  }

  /**
   * Get a specific session
   */
  async getSession(sessionId) {
    try {
      return await Session.findOne({ _id: sessionId });
    } catch (error) {
      logger.error('Failed to get session:', error);
      return null;
    }
  }

  /**
   * Update a session's last used time
   */
  async touchSession(sessionId) {
    try {
      const result = await Session.updateOne(
        { _id: sessionId, isActive: true },
        { $set: { lastUsedAt: new Date() } }
      );
      
      return result.modifiedCount > 0;
    } catch (error) {
      logger.error('Failed to touch session:', error);
      return false;
    }
  }

  /**
   * Check if a session is active
   */
  async isSessionActive(sessionId) {
    try {
      const session = await Session.findOne({ 
        _id: sessionId,
        isActive: true,
        accessTokenExpiresAt: { $gt: new Date() }
      });
      
      return !!session;
    } catch (error) {
      logger.error('Failed to check session status:', error);
      return false;
    }
  }

  /**
   * Store session token in Redis for quick lookups
   * This is useful for stateless authentication with fast token verification
   */
  async storeSessionToken(sessionId, token, ttlSeconds) {
    try {
      const key = `session:${sessionId}`;
      await redisClient.set(key, token, { EX: ttlSeconds });
    } catch (error) {
      logger.error('Failed to store session token in Redis:', error);
      // Continue without Redis - will fall back to DB checks
    }
  }

  /**
   * Get stored session token from Redis
   */
  async getStoredSessionToken(sessionId) {
    try {
      const key = `session:${sessionId}`;
      return await redisClient.get(key);
    } catch (error) {
      logger.error('Failed to get session token from Redis:', error);
      return null;
    }
  }

  /**
   * Remove session token from Redis
   */
  async removeSessionToken(sessionId) {
    try {
      const key = `session:${sessionId}`;
      await redisClient.del(key);
    } catch (error) {
      logger.error('Failed to remove session token from Redis:', error);
      // Continue without Redis - will fall back to DB checks
    }
  }

  /**
   * Temporary state storage for login (e.g., CSRF state, PKCE verifier)
   */
  async storeTempState(state, data, ttlSeconds = 600) {
    try {
      const key = `tempstate:${state}`;
      await redisClient.set(key, JSON.stringify(data), { EX: ttlSeconds });
    } catch (error) {
      logger.error('Failed to store temp state in Redis:', error);
    }
  }

  async consumeTempState(state) {
    try {
      const key = `tempstate:${state}`;
      const raw = await redisClient.get(key);
      if (!raw) return null;
      await redisClient.del(key);
      return JSON.parse(raw);
    } catch (error) {
      logger.error('Failed to consume temp state from Redis:', error);
      return null;
    }
  }
}

export default new SessionService();
