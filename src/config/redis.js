import { createClient } from 'redis';
import { logger } from '../utils/logger.js';

const redisConfig = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  sessionTTL: parseInt(process.env.REDIS_SESSION_TTL || '86400', 10), // 24 hours
  cacheTTL: parseInt(process.env.REDIS_CACHE_TTL || '3600', 10) // 1 hour
};

export const redisClient = createClient({
  url: redisConfig.url
});

export const connectRedis = async () => {
  try {
    await redisClient.connect();
    logger.info('Redis connected successfully');
  } catch (error) {
    logger.error('Redis connection error:', error);
    // Continue without Redis in dev mode
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
};

export default redisConfig;
