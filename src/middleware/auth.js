import jwt from 'jsonwebtoken';
import jwksRsa from 'jwks-rsa';
import { AppError } from '../utils/errorHandler.js';
import auth0Config from '../config/auth0.js';
import { logger } from '../utils/logger.js';
import { PERMISSIONS, ROLES } from './rbac.js';
import Session from '../models/Session.js';
import { log } from 'console';

// Setup JWT validation for Auth0 tokens
const jwksClient = jwksRsa({
  jwksUri: `https://${auth0Config.domain}/.well-known/jwks.json`,
  cache: true,
  rateLimit: true,
});

// Helper to get Auth0 signing key
const getAuth0SigningKey = async (header) => {
  if (!header.kid) throw new Error('Missing kid in token header');
  
  try {
    const key = await jwksClient.getSigningKey(header.kid);
    return key.getPublicKey();
  } catch (error) {
    logger.error('Error getting Auth0 signing key:', error);
    throw new Error('Unable to verify token');
  }
};

// Validate Auth0 Access Token
export const validateAuth0Token = async (req, res, next) => {
  try {
    logger.info('Middleware: validateAuth0Token start');
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('No token provided', 401, 'UNAUTHORIZED'));
    }

    const token = authHeader.split(' ')[1];
    
    // Verify and decode the token
    const decoded = await new Promise((resolve, reject) => {
      jwt.verify(
        token,
        async (header, callback) => {
          try {
            const key = await getAuth0SigningKey(header);
            callback(null, key);
          } catch (err) {
            callback(err);
          }
        },
        {
          audience: auth0Config.audience,
          issuer: auth0Config.issuer,
        },
        (err, decoded) => {
          if (err) {
            reject(err);
          } else {
            resolve(decoded);
          }
        }
      );
    });

    // No tenant validation needed - Auth0 handles user authentication
    
    // Attach Auth0 decoded token to request for later use
    req.auth0Token = decoded;
    logger.info('Middleware: validateAuth0Token success', { sub: decoded?.sub });
    
    next();
  } catch (error) {
    logger.error('Middleware: validateAuth0Token error', { error: error?.message });
    return next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
  }
};

// Validate our platform JWT
export const validatePlatformToken = async (req, res, next) => {
  try {
    logger.info('Middleware: validatePlatformToken start');
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('No token provided', 401, 'UNAUTHORIZED'));
    }

    const token = authHeader.split(' ')[1];
    
    // Step 1: Verify JWT signature and expiration
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Step 2: Check if session is still active in database
    const session = await Session.findOne({
      accessToken: token,
      isActive: true,
      accessTokenExpiresAt: { $gt: new Date() }
    });
    
    if (!session) {
      logger.warn('Middleware: session not found or inactive', { 
        userId: decoded.userId,
        tokenPreview: token.substring(0, 20) + '...'
      });
      return next(new AppError('Session revoked or expired', 401, 'SESSION_REVOKED'));
    }
    
    // Step 3: Update last used time
    await Session.updateOne(
      { _id: session._id },
      { $set: { lastUsedAt: new Date() } }
    );
    
    // Step 4: Attach auth info to request
    const roles = decoded.roles || [];
    let permissions = decoded.permissions || [];
    if (!permissions.length && roles.length) {
      const derived = new Set();
      roles.forEach(r => {
        if (r === ROLES.SUPER_ADMIN) {
          derived.add('*');
        } else if (PERMISSIONS[r]) {
          PERMISSIONS[r].forEach(p => derived.add(p));
        }
      });
      permissions = Array.from(derived);
    }
    req.auth = {
      userId: decoded.userId || decoded.user_id,
      sessionId: session._id,
      roles,
      permissions,
      tenantUserLinkId: decoded.tenant_user_link_id??'',// add this for indivdual chat or discuession
      tenantId: decoded.tenant_id??'',// used for the channels
      chimebearer: decoded.ChimeBerear || '',
      chimeAppInstanceArn: decoded.ChimeAppInstanceArn || '',
      chimeBackendAdminRoleArn: decoded.ChimeBackendAdminRoleArn || '',
    };
    logger.info('Middleware: validatePlatformToken attached auth', { auth: req.auth });
    logger.info('Middleware: validatePlatformToken success', { userId: decoded?.userId });
    
    next();
  } catch (error) {
    logger.error('Middleware: validatePlatformToken error', { error: error?.message });
    return next(new AppError('Invalid token', 401, 'INVALID_TOKEN'));
  }
};

// Best-effort token parsing: does not error if missing/invalid; just proceeds unauthenticated
export const tryValidatePlatformToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const roles = decoded.roles || [];
    let permissions = decoded.permissions || [];
    if (!permissions.length && roles.length) {
      const derived = new Set();
      roles.forEach(r => {
        if (r === ROLES.SUPER_ADMIN) {
          derived.add('*');
        } else if (PERMISSIONS[r]) {
          PERMISSIONS[r].forEach(p => derived.add(p));
        }
      });
      permissions = Array.from(derived);
    }
    req.auth = {
      userId: decoded.userId || decoded.user_id,
      roles,
      permissions,
       tenantUserLinkId: decoded.tenant_user_link_id??'',// add this for indivdual chat or discuession
      tenantId: decoded.tenant_id??'',// used for the channels
      chimebearer: decoded.ChimeBerear || '',
      chimeAppInstanceArn: decoded.ChimeAppInstanceArn || '',
      chimeBackendAdminRoleArn: decoded.ChimeBackendAdminRoleArn || '',
    };
    return next();
  } catch (error) {
    // Ignore errors and proceed without auth context
    return next();
  }
};
