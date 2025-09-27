import Joi from 'joi';
import { AppError } from '../utils/errorHandler.js';

/**
 * Middleware for validating request data against Joi schemas
 */
export const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source], {
      abortEarly: false,
      stripUnknown: true,
    });

    if (error) {
      const message = error.details.map((detail) => detail.message).join(', ');
      return next(new AppError(message, 422, 'VALIDATION_ERROR'));
    }

    // Replace req[source] with validated and sanitized data
    req[source] = value;
    next();
  };
};

/**
 * Common schemas
 */

// Tenant ID validation
export const tenantIdSchema = Joi.object({
  tenantId: Joi.string().required().min(2).max(50).pattern(/^[a-z0-9-]+$/),
});

// Pagination parameters
export const paginationSchema = Joi.object({
  limit: Joi.number().integer().min(1).max(100).default(50),
  cursor: Joi.string().optional(),
});

// User ID validation
export const userIdSchema = Joi.object({
  userId: Joi.string().required().pattern(/^[0-9a-fA-F]{24}$/),
});

// UUID validation
export const uuidSchema = Joi.object({
  id: Joi.string().uuid().required(),
});

// Email validation
export const emailSchema = Joi.object({
  email: Joi.string().email().required(),
});
