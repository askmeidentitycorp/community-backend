import axios from "axios";
import auth0Config from "../config/auth0.js";
import { logger } from "../utils/logger.js";
import { Tenant } from "../models/tenantModel.js";
import { TenantUserLink } from "../models/TenantUserLinkModel.js"; // your model file

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
          grant_type: "client_credentials",
        },
        {
          headers: { "Content-Type": "application/json" },
        }
      );

      this.token = response.data.access_token;
      // Set expiry 5 minutes before actual expiry to be safe
      this.tokenExpiresAt =
        Date.now() + (response.data.expires_in - 300) * 1000;
      return this.token;
    } catch (error) {
      logger.error("Failed to get Auth0 management token:", error);
      throw new Error("Failed to authenticate with Auth0 Management API");
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
              "Content-Type": "application/json",
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
              "Content-Type": "application/json",
            },
          }
        );

        return response.data;
      }
    } catch (error) {
      logger.error("Failed to upsert user in Auth0:", error);
      throw new Error("Failed to create/update user in Auth0");
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
      logger.error("Failed to get user by email from Auth0:", error);
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
      logger.error("Failed to get user by ID from Auth0:", error);
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
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      logger.error("Failed to block user in Auth0:", error);
      throw new Error("Failed to block user in Auth0");
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
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      logger.error("Failed to unblock user in Auth0:", error);
      throw new Error("Failed to unblock user in Auth0");
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
            "Content-Type": "application/json",
          },
        }
      );
    } catch (error) {
      logger.error("Failed to update user metadata in Auth0:", error);
      throw new Error("Failed to update user metadata in Auth0");
    }
  }

  // onboard tenant
  async onboardTenant(tenantData) {
    try {
      //  Validate required fields
      if (!tenantData?.tenantName || !tenantData?.slug || !tenantData?.email) {
        return {
          success: false,
          message: "Missing required fields: tenantName, slug, or email",
        };
      }

      //  Check if tenant already exists by slug or email
      const existingTenant = await Tenant.findOne({
        $or: [{ slug: tenantData.slug }, { email: tenantData.email }],
      });

      if (existingTenant) {
        return {
          success: false,
          message: "Tenant already exists with this slug or email",
        };
      }

      //  Prepare tenant data
      const tenantPayload = {
        tenantName: tenantData.tenantName,
        slug: tenantData.slug,
        email: tenantData.email,
        status: tenantData.status || "active",
        plan: tenantData.plan || "free",
        userOnboardUrl:
          tenantData.userOnboardUrl ||
          `https://${tenantData.slug}.askmeidentity.com/onboard`,
      };

      //  Save tenant in MongoDB
      const tenant = await Tenant.create(tenantPayload);

      //  Success response
      return {
        success: true,
        data: tenant,
      };
    } catch (error) {
      logger?.error?.(" Failed to onboard tenant:", error);

      return {
        success: false,
        message: error.message || "Failed to onboard tenant",
      };
    }
  }

  async addUserToTenant(tenantId, userId, role = "member", invitedBy = null) {
    try {
      //  check if link already exists
      const existingLink = await TenantUserLink.findOne({ tenantId, userId });
      if (existingLink) {
        console.log("User already part of tenant");
        return {
          success: false,
          data: existingLink,
          message: "User already part of tenant",
        };
      }

      // Create the tenant-user link
      const link = await TenantUserLink.create({
        tenantId,
        userId,
        role,
        status: "active",
        invitedBy,
        joinedAt: new Date(),
      });

      console.log("✅ User added to tenant successfully!");
      return {
        success: true,
        data: link,
      };
    } catch (err) {
      console.error("❌ Error adding user to tenant:", err.message);
      throw err;
    }
  }
}

const auth0Service = new Auth0Service();
export default auth0Service;
