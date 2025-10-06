import axios from 'axios';
import auth0Config from '../config/auth0.js';
import { logger } from '../utils/logger.js';

/**
 * Service for interacting with Auth0 Management API
 */
class Auth0Service {
  constructor() {
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  /**
   * Get a valid access token for the Auth0 Management API
   */
  async getManagementToken() {
    // Return cached token if it's still valid
    if (this.token && Date.now() < this.tokenExpiresAt) {
      return this.token;
    }

    try {
      const response = await axios.post(
        `https://${auth0Config.domain}/oauth/token`,
        {
          client_id: auth0Config.clientId,
          client_secret: auth0Config.clientSecret,
          audience: `https://${auth0Config.domain}/api/v2/`,
          grant_type: 'client_credentials',
        },
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );

      this.token = response.data.access_token;
      // Set expiry 5 minutes before actual expiry to be safe
      this.tokenExpiresAt = Date.now() + (response.data.expires_in - 300) * 1000;
      return this.token;
    } catch (error) {
      logger.error('Failed to get Auth0 management token:', error);
      throw new Error('Failed to authenticate with Auth0 Management API');
    }
  }

  /**
   * Create or update a user in Auth0
   */
  async upsertUser(userData) {
    try {
      // Check if user exists by email
      const existingUser = await this.getUserByEmail(userData.email);
      
      if (existingUser) {
        // Update existing user
        const token = await this.getManagementToken();
        const userId = existingUser.user_id;
        
        const response = await axios.patch(
          `https://${auth0Config.domain}/api/v2/users/${userId}`,
          {
            name: userData.name,
            app_metadata: userData.app_metadata,
            user_metadata: userData.user_metadata,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        
        return response.data;
      } else {
        // Create new user
        const token = await this.getManagementToken();
        
        const response = await axios.post(
          `https://${auth0Config.domain}/api/v2/users`,
          {
            email: userData.email,
            name: userData.name,
            password: userData.password,
            connection: userData.connection,
            app_metadata: userData.app_metadata,
            user_metadata: userData.user_metadata,
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        
        return response.data;
      }
    } catch (error) {
      logger.error('Failed to upsert user in Auth0:', error);
      throw new Error('Failed to create/update user in Auth0');
    }
  }

  /**
   * Get a user by email
   */
  async getUserByEmail(email) {
    try {
      const token = await this.getManagementToken();
      
      const response = await axios.get(
        `https://${auth0Config.domain}/api/v2/users-by-email`,
        {
          params: { email },
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      
      return response.data.length > 0 ? response.data[0] : null;
    } catch (error) {
      logger.error('Failed to get user by email from Auth0:', error);
      return null;
    }
  }

  /**
   * Get a user by Auth0 ID
   */
  async getUserById(userId) {
    try {
      const token = await this.getManagementToken();
      
      const response = await axios.get(
        `https://${auth0Config.domain}/api/v2/users/${userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      
      return response.data;
    } catch (error) {
      logger.error('Failed to get user by ID from Auth0:', error);
      return null;
    }
  }

  /**
   * Block a user in Auth0
   */
  async blockUser(userId) {
    try {
      const token = await this.getManagementToken();
      
      await axios.patch(
        `https://${auth0Config.domain}/api/v2/users/${userId}`,
        { blocked: true },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      logger.error('Failed to block user in Auth0:', error);
      throw new Error('Failed to block user in Auth0');
    }
  }

  /**
   * Unblock a user in Auth0
   */
  async unblockUser(userId) {
    try {
      const token = await this.getManagementToken();
      
      await axios.patch(
        `https://${auth0Config.domain}/api/v2/users/${userId}`,
        { blocked: false },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      logger.error('Failed to unblock user in Auth0:', error);
      throw new Error('Failed to unblock user in Auth0');
    }
  }

  /**
   * Update user metadata in Auth0
   */
  async updateUserMetadata(userId, metadata, isAppMetadata = false) {
    try {
      const token = await this.getManagementToken();
      
      const data = isAppMetadata 
        ? { app_metadata: metadata } 
        : { user_metadata: metadata };
      
      await axios.patch(
        `https://${auth0Config.domain}/api/v2/users/${userId}`,
        data,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
    } catch (error) {
      logger.error('Failed to update user metadata in Auth0:', error);
      throw new Error('Failed to update user metadata in Auth0');
    }
  }
}

const auth0Service = new Auth0Service();
export default auth0Service;
