import { AppError } from '../utils/errorHandler.js';
import auth0Service from '../services/auth0Service.js';
import tokenService from '../services/tokenService.js';
import sessionService from '../services/sessionService.js';
import User from '../models/User.js';
import Channel from '../models/Channel.js';
import chimeMessagingService from '../services/chimeMessagingService.js';
import { logger } from '../utils/logger.js';
import auth0Config from '../config/auth0.js';
import crypto from 'crypto';
import axios from 'axios';
import jwksRsa from 'jwks-rsa';
import jwt from 'jsonwebtoken';

/**
 * Controller for authentication endpoints
 */
class AuthController {
  constructor() {
    this.auth0Service = auth0Service;
  }
  // Ensure default general channel exists and user is a member (best-effort)
  static async ensureGeneralForUser(user) {
    try {
      let channel = await Channel.findOne({ isDefaultGeneral: true })
      if (!channel) {
        channel = await chimeMessagingService.createChannel({
          name: 'general',
          description: 'General channel for everyone',
          isPrivate: false,
          createdByUser: user,
          isDefaultGeneral: true
        })
      }
      const isMember = channel.members.some(id => String(id) === String(user._id))
      if (!isMember) {
        await chimeMessagingService.addMember({ channelId: channel._id, user })
      } else {
        await chimeMessagingService.ensureChimeMembership({ channelId: channel._id, user })
      }
    } catch (err) {
      logger.warn('Auth: ensureGeneralForUser failed (continuing)', { error: err?.message })
    }
  }
  // Helper to safely preview sensitive values in logs
  static preview(value) {
    if (!value || typeof value !== 'string') return 'missing';
    const prefix = value.slice(0, 8);
    const len = value.length;
    return `${prefix}...(${len})`;
  }
  /**
   * Exchange Auth0 token for platform JWT
   */
  async exchangeToken(req, res, next) {
    try {
      logger.info('Auth: exchangeToken start');
      // Auth0 token should be validated in middleware
      const auth0Token = req.auth0Token;
      if (!auth0Token) {
        throw new AppError('Invalid Auth0 token', 401, 'INVALID_TOKEN');
      }

      // Extract Auth0 user info
      const auth0Id = auth0Token.sub;
      const email = auth0Token.email;
      const name = auth0Token.name || email.split('@')[0];
      
      // Check if user exists in our database
      logger.info('Auth: exchangeToken decoded token', { sub: auth0Id, email });
      let user = await User.findOne({ auth0Id });
      
      if (!user) {
        // Create new user
        user = new User({
          auth0Id,
          email,
          name,
          roles: ['member'],
          status: 'active',
        });
        
        await user.save();
        logger.info('Auth: user created', { userId: user._id.toString(), email });
      } else if (user.status !== 'active') {
        throw new AppError('User account is not active', 403, 'INACTIVE_ACCOUNT');
      }
      // Best-effort: ensure general channel and membership on first login
      await AuthController.ensureGeneralForUser(user)
      
      // Create session and tokens
      const deviceInfo = {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      };
      
      const { accessToken, refreshToken, sessionId } = await tokenService.createSession(
        user._id.toString(),
        deviceInfo
      );
      logger.info('Auth: tokens issued', { userId: user._id.toString(), sessionId: sessionId?.toString?.() || sessionId });
      
      // Respond with tokens and user info
      res.status(200).json({
        token: accessToken,
        refreshToken,
        user: {
          id: user._id,
          auth0Id: user.auth0Id,
          email: user.email,
          name: user.name,
          roles: user.roles,
          status: user.status,
        },
      });
    } catch (error) {
      next(error);
    }
  }
  async auth0CodeExchange(req, res, next) {
    try {
      logger.info('Auth0: code-exchange start');
      const { code, code_verifier, redirect_uri, tenantId } = req.body || {};
      if (!code || !code_verifier) {
        throw new AppError('Missing code or code_verifier', 400, 'INVALID_REQUEST');
      }

      const redirectUri = redirect_uri || `${process.env.FRONTEND_BASE_URL || 'http://localhost:5173'}/auth/callback`;

      // Exchange code for Auth0 tokens (server-side)
      const tokenResp = await axios.post(
        `https://${auth0Config.domain}/oauth/token`,
        {
          grant_type: 'authorization_code',
          client_id: auth0Config.clientId,
          client_secret: auth0Config.clientSecret,
          code,
          redirect_uri: redirectUri,
          code_verifier,
        },
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const { id_token, access_token, refresh_token } = tokenResp.data || {};
      logger.info('Auth0: code-exchange token response', {
        id_token: id_token ? 'present' : 'missing',
        access_token_preview: AuthController.preview(access_token),
        refresh_token: refresh_token ? 'present' : 'missing',
      });

      if (!id_token) {
        throw new AppError('Missing id_token from Auth0', 500, 'AUTH0_EXCHANGE_FAILED');
      }

      // Verify ID token via Auth0 JWKS (signature + claims)
      const jwksClient = jwksRsa({
        jwksUri: `https://${auth0Config.domain}/.well-known/jwks.json`,
        cache: true,
        rateLimit: true,
      });

      const verified = await new Promise((resolve, reject) => {
        jwt.verify(
          id_token,
          async (header, callback) => {
            try {
              if (!header.kid) throw new Error('Missing kid in token header');
              const key = await jwksClient.getSigningKey(header.kid);
              callback(null, key.getPublicKey());
            } catch (err) {
              callback(err);
            }
          },
          {
            audience: auth0Config.clientId,
            issuer: auth0Config.issuer || `https://${auth0Config.domain}/`,
          },
          (err, decoded) => {
            if (err) reject(err);
            else resolve(decoded);
          }
        );
      });

      const auth0Id = verified.sub;
      const email = verified.email;
      const name = verified.name || (email ? email.split('@')[0] : 'User');
      const firstName = verified.given_name || '';
      const lastName = verified.family_name || '';
      const picture = verified.picture || ''; // Auth0 profile picture URL

      // Get or create user
      let user = await User.findOne({ auth0Id });
      if (!user) {
        user = new User({
          auth0Id,
          email,
          firstName,
          lastName,
          name,
          isActive: true,
          isVerified: true,
          lastLogin: new Date(),
          roles: ['member'],
        });
        
        // Set Auth0 profile picture if available
        if (picture) {
          user.auth0Picture = picture;
          user.avatarSource = 'auth0';
          user.profilePicture = picture; // Also set profilePicture for backward compatibility
        }
        
        await user.save();
        logger.info('Auth0: user created (code-exchange)', { 
          userId: user._id.toString(), 
          email,
          hasPicture: !!picture,
          avatarSource: user.avatarSource
        });
        const result = await auth0Service.addUserToTenant(tenantId.toString(), user._id.toString(), 'member')
        if(!result.success){
          logger.error('Auth0: failed to add user to tenant', { userId: user._id.toString(), reason: result.message });
          throw new AppError(result.message, 500, 'TENANT_USER_ADDITION_FAILED');
        }
        logger.info('Auth0: user added to tenant', { userId: user._id.toString(), tenantId: result.data.tenantId });
      } else {
        user.lastLogin = new Date();
        
        // Update Auth0 picture if it's different and user hasn't uploaded their own
        if (picture && user.avatarSource !== 'uploaded') {
          if (user.auth0Picture !== picture) {
            user.auth0Picture = picture;
            user.avatarSource = 'auth0';
            user.profilePicture = picture;
            logger.info('Auth0: updated profile picture (code-exchange)', { 
              userId: user._id.toString(),
              oldPicture: user.auth0Picture,
              newPicture: picture
            });
          }
        }
        
        await user.save();
        logger.info('Auth0: user login (code-exchange)', { userId: user._id.toString(), email });
      }
      // ensure general channel and membership on login
      await AuthController.ensureGeneralForUser(user)

      if (!user.isActive || user.isDeleted) {
        throw new AppError('User account is not active', 403, 'INACTIVE_ACCOUNT');
      }
      //: ensure general channel and membership on login
      await AuthController.ensureGeneralForUser(user)

      // Issue platform tokens
      const deviceInfo = {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      };

      const { accessToken, refreshToken, sessionId } = await tokenService.createSession(
        user._id.toString(),
        deviceInfo,
        access_token,
        auth0Id,
        refresh_token
      );
      logger.info('Auth0: platform tokens issued (code-exchange)', {
        userId: user._id.toString(),
        sessionId: sessionId?.toString?.() || sessionId,
        accessToken_preview: AuthController.preview(accessToken),
        refreshToken_preview: AuthController.preview(refreshToken),
      });

      return res.status(200).json({
        token: accessToken,
        refreshToken,
        id_token: id_token, // Include Auth0 ID token for Cognito Identity Pool logins
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          roles: Array.isArray(user.roles) ? user.roles : [],
          avatarUrl: user.avatarUrl, // Use the virtual property
          avatarSource: user.avatarSource,
        },
      });
    
    } catch (error) {
      logger.error('Auth0: code-exchange error', { error: error?.message });
      next(error);
    }
  }

  /**
   * Refresh Auth0 ID token for Chime authentication
   */
  async refreshAuth0IdToken(req, res, next) {
    try {
      logger.info('Auth: refreshAuth0IdToken start');
      
      // Get the user from the platform token
      const user = req.user;
      if (!user) {
        throw new AppError('User not found in request', 401, 'UNAUTHORIZED');
      }

      // Get the stored Auth0 refresh token from the session
      const session = await Session.findOne({ userId: user._id }).sort({ createdAt: -1 });
      if (!session || !session.auth0RefreshToken) {
        throw new AppError('No Auth0 refresh token found', 400, 'NO_REFRESH_TOKEN');
      }

      // Exchange Auth0 refresh token for new tokens
      const tokenResp = await axios.post(
        `https://${auth0Config.domain}/oauth/token`,
        {
          grant_type: 'refresh_token',
          client_id: auth0Config.clientId,
          client_secret: auth0Config.clientSecret,
          refresh_token: session.auth0RefreshToken,
        },
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const { id_token, access_token, refresh_token } = tokenResp.data || {};
      
      if (!id_token) {
        throw new AppError('No ID token in refresh response', 500, 'AUTH0_REFRESH_FAILED');
      }

      // Update session with new tokens
      session.auth0AccessToken = access_token;
      session.auth0RefreshToken = refresh_token || session.auth0RefreshToken; // Keep old refresh token if new one not provided
      await session.save();

      logger.info('Auth: Auth0 ID token refreshed', {
        userId: user._id.toString(),
        sessionId: session._id.toString(),
        id_token: id_token ? 'present' : 'missing'
      });

      return res.status(200).json({
        id_token: id_token,
        expires_in: 3600 // Auth0 ID tokens typically expire in 1 hour
      });

    } catch (error) {
      logger.error('Auth: refreshAuth0IdToken error', { error: error?.message });
      next(error);
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(req, res, next) {
    try {
      logger.info('Auth: refreshToken start');
      // Accept both camelCase and snake_case for compatibility with validators/clients
      const refreshToken = req.body.refreshToken || req.body.refresh_token;
      
      if (!refreshToken) {
        throw new AppError('Refresh token is required', 400, 'TOKEN_REQUIRED');
      }
      
      const accessToken = await tokenService.refreshAccessToken(refreshToken);
      
      if (!accessToken) {
        throw new AppError('Invalid refresh token', 401, 'INVALID_TOKEN');
      }
      logger.info('Auth: refreshToken success');
      
      res.status(200).json({
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: parseInt(process.env.JWT_ACCESS_TTL || '3600', 10),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Logout (revoke session)
   */
  async logout(req, res, next) {
    try {
      logger.info('Auth: logout start');
      // Auth middleware should validate and attach auth info
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      
      const { sessionId } = req.auth;
      
      if (!sessionId) {
        throw new AppError('Invalid session', 400, 'INVALID_SESSION');
      }
      
      const success = await tokenService.revokeSession(sessionId);
      
      if (success) {
        // Also remove from Redis if available
        await sessionService.removeSessionToken(sessionId);
        logger.info('Auth: logout success', { sessionId });
        res.status(200).json({
          message: 'Logged out successfully',
        });
      } else {
        throw new AppError('Failed to logout', 500, 'LOGOUT_FAILED');
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Validate platform JWT
   */
  async validateToken(req, res, next) {
    try {
      logger.info('Auth: validateToken start');
      // Auth middleware should validate and attach auth info
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      
      // Get user info
      const user = await User.findOne(
        { _id: req.auth.userId },
        { password: 0 }
      );
      
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }
      
      logger.info('Auth: validateToken success', { userId: user._id.toString() });
      res.status(200).json({
        valid: true,
        user: {
          id: user._id,
          email: user.email,
          name: user.name,
          firstName: user.firstName,
          lastName: user.lastName,
          roles: Array.isArray(user.roles) ? user.roles : [],
        },
        expires_in: parseInt(process.env.JWT_ACCESS_TOKEN_LIFETIME || '3600', 10),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user profile
   */
  async getProfile(req, res, next) {
    try {
      logger.info('Auth: getProfile start');
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      
      const user = await User.findOne(
        { _id: req.auth.userId },
        { password: 0 }
      );
      
      if (!user) {
        throw new AppError('User not found', 404, 'USER_NOT_FOUND');
      }
      
      logger.info('Auth: getProfile success', { userId: user._id.toString() });
      res.status(200).json({
        id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        name: user.name,
        roles: Array.isArray(user.roles) ? user.roles : [],
        phone: user.phone,
        bio: user.bio,
        profilePicture: user.profilePicture,
        timezone: user.timezone,
        language: user.language,
        isActive: user.isActive,
        isVerified: user.isVerified,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user sessions
   */
  async getSessions(req, res, next) {
    try {
      logger.info('Auth: getSessions start');
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      
      const sessions = await sessionService.getUserSessions(req.auth.userId);
      
      logger.info('Auth: getSessions success', { userId: req.auth.userId, count: sessions.length });
      res.status(200).json({
        sessions: sessions.map(session => ({
          id: session.id,
          createdAt: session.createdAt,
          lastUsedAt: session.lastUsedAt,
          device: session.device,
          expiresAt: session.expiresAt,
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke specific session
   */
  async revokeSession(req, res, next) {
    try {
      logger.info('Auth: revokeSession start');
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      
      const { sessionId } = req.body;
      if (!sessionId) {
        throw new AppError('Session ID is required', 400, 'SESSION_ID_REQUIRED');
      }
      
      const success = await tokenService.revokeSession(sessionId);
      
      if (success) {
        logger.info('Auth: revokeSession success', { sessionId });
        res.status(200).json({ message: 'Session revoked successfully' });
      } else {
        throw new AppError('Failed to revoke session', 500, 'REVOKE_FAILED');
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke all sessions except current
   */
  async revokeAllSessions(req, res, next) {
    try {
      logger.info('Auth: revokeAllSessions start');
      if (!req.auth) {
        throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
      }
      
      const success = await tokenService.revokeAllSessions(req.auth.userId, req.auth.sessionId);
      
      if (success) {
        logger.info('Auth: revokeAllSessions success', { userId: req.auth.userId });
        res.status(200).json({ message: 'All sessions revoked successfully' });
      } else {
        throw new AppError('Failed to revoke sessions', 500, 'REVOKE_FAILED');
      }
    } catch (error) {
      next(error);
    }
  }

  // Initiate login via Auth0 (Authorization Code with PKCE)
  async auth0LoginInitiate(req, res, next) {
    try {
      logger.info('Auth0: login initiate', {
        redirect_uri: req.query.redirect_uri,
        backend_base_url: process.env.BACKEND_BASE_URL || 'missing',
        frontend_base_url: process.env.FRONTEND_BASE_URL || 'missing',
        auth0: {
          domain: auth0Config.domain || 'missing',
          audience: auth0Config.audience || 'missing',
          issuer: auth0Config.issuer || `https://${auth0Config.domain || 'missing'}/`,
          clientId: auth0Config.clientId ? 'set' : 'missing'
        }
      });
      const frontendRedirect = req.query.redirect_uri || (process.env.FRONTEND_BASE_URL || 'http://localhost:5173')
      
      // Validate redirect URI for security
      if (!frontendRedirect || !frontendRedirect.startsWith(process.env.FRONTEND_BASE_URL || 'http://localhost:5173')) {
        throw new AppError('Invalid redirect URI', 400, 'INVALID_REDIRECT_URI')
      }
      
      // Generate cryptographic state parameter for CSRF protection
      const state = crypto.randomBytes(16).toString('hex')
      const codeVerifier = crypto.randomBytes(32).toString('base64url')
      const codeChallenge = crypto
        .createHash('sha256')
        .update(codeVerifier)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')

      // Store state and verifier with IP and user agent metadata
      const stateData = {
        codeVerifier,
        frontendRedirect,
        ip: req.ip,
        userAgent: req.headers['user-agent']
      }
      await sessionService.storeTempState(state, stateData, 300) // 5 minutes TTL
      logger.info('Auth0: temp state stored', { state, ip: stateData.ip });

      const params = new URLSearchParams({
        client_id: auth0Config.clientId,
        response_type: 'code',
        redirect_uri: `${process.env.BACKEND_BASE_URL}/api/v1/auth/auth0/callback`,
        scope: 'openid profile email',
        audience: auth0Config.audience,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        organization: auth0Config.organizationId || '',
        prompt: 'select_account'
      })

      const authorizeUrl = `https://${auth0Config.domain}/authorize?${params.toString()}`
      logger.info('Auth0: redirecting to authorize', {
        url_preview: authorizeUrl.split('?')[0],
        domain: auth0Config.domain,
        audience: auth0Config.audience || 'missing',
        clientId: auth0Config.clientId ? 'set' : 'missing'
      });
      return res.redirect(authorizeUrl)
    } catch (error) {
      logger.error('Auth0: login initiate error', { error: error?.message });
      next(error)
    }
  }

  // Auth0 callback; exchange code for tokens and redirect to frontend with platform tokens
  async auth0Callback(req, res, next) {
    try {
      logger.info('Auth0: callback received', { state: req.query.state ? 'present' : 'missing', code: req.query.code ? 'present' : 'missing' });
      const { code, state } = req.query
      if (!code || !state) {
        throw new AppError('Missing code or state', 400, 'INVALID_CALLBACK')
      }

      // State validation with IP and user agent verification
      const stored = await sessionService.consumeTempState(state)
      if (!stored) {
        throw new AppError('Invalid state', 400, 'INVALID_STATE')
      }

      // Verify IP and user agent for additional security
      if (stored.ip !== req.ip || stored.userAgent !== req.headers['user-agent']) {
        throw new AppError('State validation failed', 400, 'INVALID_STATE')
      }

      const { codeVerifier, frontendRedirect } = stored

      // Exchange code for Auth0 tokens
      const tokenResp = await axios.post(`https://${auth0Config.domain}/oauth/token`, {
        grant_type: 'authorization_code',
        client_id: auth0Config.clientId,
        client_secret: auth0Config.clientSecret,
        code,
        redirect_uri: `${process.env.BACKEND_BASE_URL}/api/v1/auth/auth0/callback`,
        code_verifier: codeVerifier,
      }, { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      logger.info('Auth0: token exchange success');

      const { id_token, access_token } = tokenResp.data
      logger.info('Auth0: token response received', {
        id_token: id_token ? 'present' : 'missing',
        access_token_preview: AuthController.preview(access_token)
      });

      // Verify ID token via Auth0 JWKS (signature + claims)
      const jwksClient = jwksRsa({
        jwksUri: `https://${auth0Config.domain}/.well-known/jwks.json`,
        cache: true,
        rateLimit: true,
      })

      const verified = await new Promise((resolve, reject) => {
        jwt.verify(
          id_token,
          async (header, callback) => {
            try {
              if (!header.kid) throw new Error('Missing kid in token header')
              const key = await jwksClient.getSigningKey(header.kid)
              callback(null, key.getPublicKey())
            } catch (err) {
              callback(err)
            }
          },
          {
            audience: auth0Config.clientId,
            issuer: auth0Config.issuer || `https://${auth0Config.domain}/`,
          },
          (err, decoded) => {
            if (err) reject(err)
            else resolve(decoded)
          }
        )
      })

      const auth0Id = verified.sub
      const email = verified.email
      const name = verified.name || (email ? email.split('@')[0] : 'User')
      const firstName = verified.given_name || ''
      const lastName = verified.family_name || ''
      const picture = verified.picture || '' // Auth0 profile picture URL

      // Get or create LMSUser record
      let user = await User.findOne({ auth0Id })
      if (!user) {
        user = new User({
          auth0Id,
          email,
          firstName,
          lastName,
          name,
          isActive: true,
          isVerified: true,
          lastLogin: new Date(),
          roles: ['member']
        })
        
        // Set Auth0 profile picture if available
        if (picture) {
          user.auth0Picture = picture
          user.avatarSource = 'auth0'
          user.profilePicture = picture // Also set profilePicture for backward compatibility
        }
        
        await user.save()
        logger.info('Auth0: user created', { 
          userId: user._id.toString(), 
          email, 
          hasPicture: !!picture,
          avatarSource: user.avatarSource 
        })
        
      } else {
        // Update last login and Auth0 picture if it changed
        user.lastLogin = new Date()
        
        // Update Auth0 picture if it's different and user hasn't uploaded their own
        if (picture && user.avatarSource !== 'uploaded') {
          if (user.auth0Picture !== picture) {
            user.auth0Picture = picture
            user.avatarSource = 'auth0'
            user.profilePicture = picture
            logger.info('Auth0: updated profile picture', { 
              userId: user._id.toString(),
              oldPicture: user.auth0Picture,
              newPicture: picture 
            })
          }
        }
        
        await user.save()
        logger.info('Auth0: user login', { userId: user._id.toString(), email })
      }

      if (!user.isActive || user.isDeleted) {
        throw new AppError('User account is not active', 403, 'INACTIVE_ACCOUNT')
      }

      // Create session and tokens
      const deviceInfo = {
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      }
      
      const { accessToken, refreshToken, sessionId } = await tokenService.createSession(
        user._id.toString(),
        deviceInfo,
        access_token,
        auth0Id
      )
      logger.info('Auth0: platform tokens issued', {
        userId: user._id.toString(),
        sessionId: sessionId?.toString?.() || sessionId,
        accessToken_preview: AuthController.preview(accessToken),
        refreshToken_preview: AuthController.preview(refreshToken)
      })

      // Redirect to frontend with authentication data
      const fe = new URL(frontendRedirect)
      fe.searchParams.set('access_token', accessToken)
      fe.searchParams.set('refresh_token', refreshToken)
      fe.searchParams.set('expires_in', String(parseInt(process.env.JWT_ACCESS_TOKEN_LIFETIME || '3600', 10)))
      fe.searchParams.set('token_type', 'Bearer')
      // Include Auth0 id_token for Cognito Identity Pool logins on the frontend
      if (id_token) {
        fe.searchParams.set('id_token', id_token)
      }
      fe.searchParams.set('user', encodeURIComponent(JSON.stringify({
        id: user._id,
        email: user.email,
        name: user.name,
        firstName: user.firstName,
        lastName: user.lastName,
        roles: Array.isArray(user.roles) ? user.roles : [],
        avatarUrl: user.avatarUrl,
        avatarSource: user.avatarSource
      })))

      logger.info('Auth0: redirecting back to FE', {
        fe_origin: fe.origin,
        fe_path: fe.pathname,
        has_access_token: !!accessToken,
        has_refresh_token: !!refreshToken,
        query_keys: Array.from(fe.searchParams.keys())
      });
      return res.redirect(fe.toString())
    } catch (error) {
      logger.error('Auth0: callback error', { error: error?.message });
      next(error)
    }
  }

  /**
   * 
    * Onboard new tenant
   */
  async onboardTenant(req, res, next) {
    try{
      logger.info('Auth: onboardTenant start');
      const { tenantName,slug,domain,email,phoneNumber,status } = req.body;
      
      //onboard tenant via auth0 service
      const result = await auth0Service.onboardTenant({ tenantName,slug,domain,email,phoneNumber,status  });
      
      if(!result.success){
        logger.error('Auth: onboardTenant failed', { tenantDomain: domain, reason: result.message });
        throw new AppError(result.message, 500, 'TENANT_ONBOARDING_FAILED');
      }
      res.status(200).json({
        message: 'Tenant onboarded successfully',
        tenantId: result.data
      });
      logger.info('Auth: onboardTenant success', { tenantDomain: domain });

    }catch (error) {
      logger.error('Auth: onboardTenant error', { error: error?.message });
      next(error);
    }
  }
}

export default new AuthController();
