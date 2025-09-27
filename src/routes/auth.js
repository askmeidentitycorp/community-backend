import express from 'express';
import authController from '../controllers/authController.js';
import { validateAuth0Token, validatePlatformToken } from '../middleware/auth.js';
import { validate } from '../middleware/validation.js';
import Joi from 'joi';

const router = express.Router();

// Schemas
const refreshTokenSchema = Joi.object({
  refresh_token: Joi.string().required(),
});

const revokeSessionSchema = Joi.object({
  session_id: Joi.string().required(),
});

// Routes
// Auth0 Redirect-based flow
router.get('/auth0/login', authController.auth0LoginInitiate);
router.get('/auth0/callback', authController.auth0Callback);

// Token management
router.post(
  '/refresh/',
  validate(refreshTokenSchema),
  authController.refreshToken
);

router.post(
  '/validate/',
  validatePlatformToken,
  authController.validateToken
);

router.post(
  '/logout/',
  validatePlatformToken,
  authController.logout
);

// User profile
router.get(
  '/profile/',
  validatePlatformToken,
  authController.getProfile
);

// Session management
router.get(
  '/sessions/',
  validatePlatformToken,
  authController.getSessions
);

router.post(
  '/revoke-session/',
  validatePlatformToken,
  validate(revokeSessionSchema),
  authController.revokeSession
);

router.post(
  '/revoke-all-sessions/',
  validatePlatformToken,
  authController.revokeAllSessions
);

export default router;
