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

const codeExchangeSchema = Joi.object({
  code: Joi.string().required(),
  code_verifier: Joi.string().required(),
  redirect_uri: Joi.string().uri().optional(),
  tenantId: Joi.string().optional(),
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
  '/exchange/',
  validateAuth0Token,
  authController.exchangeToken
);

// Frontend sends code + code_verifier; backend exchanges with Auth0 and issues platform tokens
router.post(
  '/auth0/code-exchange/',
  validate(codeExchangeSchema),
  authController.auth0CodeExchange
);

router.post(
  '/refresh-auth0-id-token/',
  validatePlatformToken,
  authController.refreshAuth0IdToken
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


router.post('/onboard-tenant/', authController.onboardTenant);
router.get('/tenants/organizations/', authController.getTenantOrganizations);

export default router;
