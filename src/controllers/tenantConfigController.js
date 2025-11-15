import { AppError } from '../utils/errorHandler.js';
import { TenantConfig } from '../models/TenantConfig.js';
import { logger } from '../utils/logger.js';
import { ROLES } from '../middleware/rbac.js';

class TenantConfigController {
  /**
   * GET /api/v1/tenant-config
   * Get tenant configuration for the current user's tenant
   * Public endpoint (authenticated users can read)
   */
  async getTenantConfig(req, res, next) {
    try {
      // Ensure user is authenticated
      if (!req.auth || !req.auth.userId) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      const tenantId = req.auth.tenantId;

      // Validate tenant ID exists
      if (!tenantId) {
        logger.warn('TenantConfig.getTenantConfig: No tenant ID found in token', {
          userId: req.auth.userId,
        });
        // Return default empty config if no tenant ID
        return res.status(200).json({
          tenantId: null,
          tags: [],
          logo: {
            url: null,
            uploadedAt: null,
          },
        });
      }

      // Find or create config for this tenant
      let config = await TenantConfig.findOrCreate(tenantId);

      logger.info('TenantConfig.getTenantConfig: success', {
        userId: req.auth.userId,
        tenantId: tenantId.toString(),
        tagsCount: config.tags?.length || 0,
      });

      return res.status(200).json({
        tenantId: config.tenantId,
        tags: config.tags || [],
        logo: config.logo || {
          url: null,
          uploadedAt: null,
        },
        updatedAt: config.updatedAt,
      });
    } catch (error) {
      logger.error('TenantConfig.getTenantConfig: error', {
        error: error?.message,
        stack: error?.stack,
      });
      next(error);
    }
  }

  /**
   * PUT /api/v1/tenant-config
   * Update tenant configuration
   * Requires: super_admin role
   */
  async updateTenantConfig(req, res, next) {
    try {
      // Ensure user is authenticated
      if (!req.auth || !req.auth.userId) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }

      // Check if user has super_admin role
      const roles = req.auth.roles || [];
      if (!roles.includes(ROLES.SUPER_ADMIN)) {
        throw new AppError(
          'Insufficient permissions. Only super_admin can update tenant configuration',
          403,
          'FORBIDDEN'
        );
      }

      const tenantId = req.auth.tenantId;

      // Validate tenant ID exists
      if (!tenantId) {
        throw new AppError('Tenant ID not found in token', 400, 'BAD_REQUEST');
      }

      const { tags, logo } = req.body;

      // Find or create config for this tenant
      let config = await TenantConfig.findOrCreate(tenantId);

      // Update tags if provided
      if (tags !== undefined) {
        if (!Array.isArray(tags)) {
          throw new AppError('Tags must be an array', 400, 'VALIDATION_ERROR');
        }

        // Validate tag count
        if (tags.length > 50) {
          throw new AppError('Maximum 50 tags allowed per tenant', 400, 'VALIDATION_ERROR');
        }

        // Validate each tag structure
        const tagIds = new Set();
        for (const tag of tags) {
          if (!tag.id || typeof tag.id !== 'string') {
            throw new AppError('Each tag must have a valid id (string)', 400, 'VALIDATION_ERROR');
          }
          if (!tag.name || typeof tag.name !== 'string') {
            throw new AppError('Each tag must have a valid name (string)', 400, 'VALIDATION_ERROR');
          }
          if (!tag.color || typeof tag.color !== 'string') {
            throw new AppError('Each tag must have a valid color (string)', 400, 'VALIDATION_ERROR');
          }

          // Validate color format (hex)
          if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/.test(tag.color)) {
            throw new AppError(
              `Invalid color format for tag "${tag.id}": ${tag.color}. Must be hex format (e.g., #FF5733)`,
              400,
              'VALIDATION_ERROR'
            );
          }

          // Check for duplicate IDs
          const normalizedId = tag.id.trim().toLowerCase();
          if (tagIds.has(normalizedId)) {
            throw new AppError(`Duplicate tag ID: ${tag.id}`, 400, 'VALIDATION_ERROR');
          }
          tagIds.add(normalizedId);

          // Validate name length
          if (tag.name.trim().length === 0 || tag.name.length > 50) {
            throw new AppError(
              `Tag name must be between 1 and 50 characters for tag "${tag.id}"`,
              400,
              'VALIDATION_ERROR'
            );
          }
        }

        // Normalize tags (lowercase IDs, trim values)
        config.tags = tags.map(tag => ({
          id: tag.id.trim().toLowerCase(),
          name: tag.name.trim(),
          color: tag.color.trim(),
        }));
      }

      // Update logo if provided
      if (logo !== undefined) {
        if (logo === null) {
          // Clear logo
          config.logo = {
            url: null,
            uploadedAt: null,
          };
        } else if (typeof logo === 'object') {
          // Validate logo URL if provided
          if (logo.url !== undefined) {
            if (logo.url === null || logo.url === '') {
              config.logo = {
                url: null,
                uploadedAt: null,
              };
            } else {
              // Basic URL validation
              try {
                new URL(logo.url);
                config.logo = {
                  url: logo.url.trim(),
                  uploadedAt: logo.uploadedAt ? new Date(logo.uploadedAt) : new Date(),
                };
              } catch (e) {
                throw new AppError('Invalid logo URL format', 400, 'VALIDATION_ERROR');
              }
            }
          } else {
            // Only update uploadedAt if url is not provided
            if (logo.uploadedAt) {
              config.logo.uploadedAt = new Date(logo.uploadedAt);
            }
          }
        } else {
          throw new AppError('Logo must be an object or null', 400, 'VALIDATION_ERROR');
        }
      }

      // Update updatedBy field
      config.updatedBy = req.auth.userId;

      // Save the config
      await config.save();

      logger.info('TenantConfig.updateTenantConfig: success', {
        userId: req.auth.userId,
        tenantId: tenantId.toString(),
        tagsCount: config.tags?.length || 0,
        hasLogo: !!config.logo?.url,
      });

      return res.status(200).json({
        tenantId: config.tenantId,
        tags: config.tags || [],
        logo: config.logo || {
          url: null,
          uploadedAt: null,
        },
        updatedAt: config.updatedAt,
        message: 'Tenant configuration updated successfully',
      });
    } catch (error) {
      logger.error('TenantConfig.updateTenantConfig: error', {
        error: error?.message,
        stack: error?.stack,
        userId: req.auth?.userId,
      });
      next(error);
    }
  }
}

export default new TenantConfigController();

