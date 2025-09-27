import { Types } from 'mongoose';

/**
 * Helper functions for common operations
 */

/**
 * Validates MongoDB ObjectId
 */
export const isValidObjectId = (id) => {
  return Types.ObjectId.isValid(id);
};

/**
 * Creates a URL-friendly slug from a string
 */
export const createSlug = (str) => {
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
};

/**
 * Generates a random token
 */
export const generateRandomToken = (length = 32) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Gets verification expiry time
 */
export const getVerificationExpiry = () => {
  const now = new Date();
  now.setHours(now.getHours() + 24); // 24 hours from now
  return now;
};

/**
 * Creates a slug from a string
 */
export const createSlug = (text) => {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
};

/**
 * Generates a random string for verification tokens
 */
export const generateRandomToken = (length = 32) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = 'verif_';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Gets expiry date for verification tokens (7 days from now)
 */
export const getVerificationExpiry = () => {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date;
};
