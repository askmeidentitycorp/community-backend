import express from 'express';
import tenantConfigController from '../controllers/tenantConfigController.js';
import { validatePlatformToken } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { validate } from '../middleware/validation.js';
import Joi from 'joi';

const router = express.Router();

// Tag schema for validation
const tagSchema = Joi.object({
  id: Joi.string().trim().min(1).max(50).required(),
  name: Joi.string().trim().min(1).max(50).required(),
  color: Joi.string().trim().pattern(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/).required()
    .messages({
      'string.pattern.base': 'Color must be a valid hex color (e.g., #FF5733 or #FF5733FF)',
    }),
});

// Logo schema for validation
const logoSchema = Joi.object({
  url: Joi.string().uri().allow(null, '').optional(),
  uploadedAt: Joi.date().allow(null).optional(),
}).allow(null);

// Update tenant config schema
const updateTenantConfigSchema = Joi.object({
  tags: Joi.array().items(tagSchema).max(50).optional(),
  logo: logoSchema.optional(),
}).min(1); // At least one field must be provided

/**
 * GET /api/v1/tenant-config
 * Get tenant configuration for the current user's tenant
 * Public endpoint (authenticated users can read)
 */
router.get(
  '/tenant-config',
  validatePlatformToken,
  tenantConfigController.getTenantConfig
);

/**
 * PUT /api/v1/tenant-config
 * Update tenant configuration
 * Requires: super_admin role
 */
router.put(
  '/tenant-config',
  validatePlatformToken,
  requireRole(['super_admin']),
  validate(updateTenantConfigSchema),
  tenantConfigController.updateTenantConfig
);

export default router;

