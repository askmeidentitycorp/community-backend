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
      console.error(
        "Error fetching Auth0 management token:",
        error.response?.data || error.message
      );
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
      // Validate required fields
      if (
        !tenantData?.tenantName ||
        !tenantData?.slug ||
        !tenantData?.email ||
        !tenantData?.password
      ) {
        return {
          success: false,
          message:
            "Missing required fields: tenantName, slug, email or password",
        };
      }

      // Check if tenant already exists by slug or email
      const existingTenant = await Tenant.findOne({
        $or: [{ slug: tenantData.slug }, { email: tenantData.email }],
      });

      if (existingTenant) {
        return {
          success: false,
          message: "Tenant already exists with this slug or email",
        };
      }

      // Get Auth0 management token
      const token = await this.getManagementToken();
      if (!token) {
        return {
          success: false,
          message: "Failed to obtain Auth0 management token",
        };
      }

      const orgResponse = await this.createAuth0Organization(tenantData, token);
      if (!orgResponse.success) {
        return orgResponse;
      }

      const connectionResponse = await this.createAuth0Connection(
        tenantData,
        token
      );
      if (!connectionResponse.success) {
        return connectionResponse;
      }

      const linkResponse = await this.linkConnectionToOrganization(
        orgResponse.data.organizationId,
        connectionResponse.data.connectionId,
        token
      );
      if (!linkResponse.success) {
        return linkResponse;
      }

      // delay for auth0 consistency
      console.log("Waiting for connection to be ready...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const adminResponse = await this.createOrganizationAdmin(
        orgResponse.data.organizationId,
        tenantData, // Pass entire tenantData object
        token,
        connectionResponse.data.connectionName 
      );

      if (!adminResponse.success) {
        return adminResponse;
      }

      // Prepare tenant data with Auth0 references
      const tenantPayload = {
        tenantName: tenantData.tenantName,
        slug: tenantData.slug,
        email: tenantData.email,
        status: tenantData.status || "active",
        plan: tenantData.plan || "free",
        userOnboardUrl:
          tenantData.userOnboardUrl ||
          `https://${tenantData.slug}.askmeidentity.com/onboard`,
        auth0: {
          organizationId: orgResponse.data.organizationId,
          connectionId: connectionResponse.data.connectionId,
          adminUserId: adminResponse.data.userId,
          connectionName: connectionResponse.data.connectionName,
        },
      };

      // Save tenant in MongoDB
      const tenant = await Tenant.create(tenantPayload);

      // Success response
      return {
        success: true,
        data: tenant,
        auth0: {
          organization: orgResponse.data,
          connection: connectionResponse.data,
          admin: adminResponse.data,
        },
      };
    } catch (error) {
      logger?.error?.("Failed to onboard tenant:", error);
      return {
        success: false,
        message: error.message || "Failed to onboard tenant",
      };
    }
  }

  
  async createAuth0Organization(tenantData, token) {
    try {
      // Format organization name according to Auth0 requirements
      const organizationName = this.formatOrganizationName(tenantData.slug);
      const displayName = tenantData.tenantName;
      // Prepare the request payload with null for optional URLs
      const payload = {
        name: organizationName,
        display_name: displayName,
        branding: {
          logo_url: "https://askmeidentity.com/img/logo_aaa.538b2e29.webp",
          colors: {
            primary: tenantData.primaryColor || "#005ea2",
            page_background: tenantData.backgroundColor || "#ffffff",
          },
        },
        metadata: {
          tenant_slug: tenantData.slug,
          //   tenant_id: tenantData._id?.toString() || "",
          //   plan: tenantData.plan || 'free',
          created_via: "api",
        },
      };

      // Log the actual payload being sent
      console.log(
        "Auth0 Organization Payload:",
        JSON.stringify(payload, null, 2)
      );
      console.log("Organization Name:", organizationName);
      console.log("Organization Name Type:", typeof organizationName);

      const response = await fetch(
        `https://${auth0Config.domain}/api/v2/organizations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Auth0 organization creation error:", errorData);
        throw new Error(
          errorData.message ||
            `HTTP ${response.status}: Failed to create Auth0 organization`
        );
      }

      const orgData = await response.json();

      return {
        success: true,
        data: {
          organizationId: orgData.id,
          organizationName: orgData.name,
          displayName: orgData.display_name,
        },
      };
    } catch (error) {
      logger?.error?.("Failed to create Auth0 organization:", error);
      return {
        success: false,
        message: `Auth0 organization creation failed: ${error.message}`,
      };
    }
  }

  formatOrganizationName(tenantData) {
    return `org-${Date.now()}`;
  }

  async createAuth0Connection(tenantData, token) {
    try {
      const connectionName = `${tenantData.slug.toLowerCase()}-${
        tenantData.email.split("@")[0]
      }-connection`;
      const payload = {
        name: connectionName,
        display_name: `${tenantData.tenantName} Database Connection`,
        strategy: "auth0",
        options: {
          // Remove validation object since we're using attributes
          non_persistent_attrs: [],
          precedence: ["email", "username", "phone_number"],
          attributes: {
            email: {
              identifier: { active: true },
              profile_required: true,
              verification_method: "link",
              signup: {
                status: "required",
                verification: { active: true },
              },
            },
            username: {
              identifier: { active: false },
              profile_required: false,
              signup: {},
            },
            phone_number: {
              identifier: { active: false },
              profile_required: false,
              signup: {},
            },
          },
          authentication_methods: {
            password: { enabled: true },
            passkey: { enabled: false },
          },
          passwordPolicy: "good",
          password_complexity_options: {
            min_length: 8,
          },
          password_history: {
            enable: true,
            size: 5,
          },
          password_no_personal_info: {
            enable: true,
          },
          api_enable_users: true,
          basic_profile: true,
          ext_profile: true,
          disable_self_service_change_password: false,
        },
        enabled_clients: [auth0Config.clientId],
        is_domain_connection: false,
        realms: [tenantData.slug],
        metadata: {
          tenant_slug: tenantData.slug,
          tenant_name: tenantData.tenantName,
        },
      };

      console.log("Connection Payload:", JSON.stringify(payload, null, 2));

      const response = await fetch(
        `https://${auth0Config.domain}/api/v2/connections`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Auth0 connection creation error:", errorData);
        throw new Error(
          errorData.message || "Failed to create Auth0 connection"
        );
      }

      const connectionData = await response.json();

      return {
        success: true,
        data: {
          connectionId: connectionData.id,
          connectionName: connectionData.name,
        },
      };
    } catch (error) {
      logger?.error?.("Failed to create Auth0 connection:", error);
      return {
        success: false,
        message: `Auth0 connection creation failed: ${error.message}`,
      };
    }
  }

  // Helper method to link connection to organization
  async linkConnectionToOrganization(organizationId, connectionId, token) {
    try {
      const response = await fetch(
        `https://${auth0Config.domain}/api/v2/organizations/${organizationId}/enabled_connections`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: JSON.stringify({
            connection_id: connectionId,
            assign_membership_on_login: true,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(
          error.message || "Failed to link connection to organization"
        );
      }

      return { success: true };
    } catch (error) {
      logger?.error?.("Failed to link connection to organization:", error);
      return {
        success: false,
        message: `Connection linking failed: ${error.message}`,
      };
    }
  }

  async createOrganizationAdmin(
    organizationId,
    tenantData,
    token,
    connectionId
  ) {
    try {
      // Use the actual connection ID that was created, not the name
      const connectionName = `${tenantData.slug.toLowerCase()}-${
        tenantData.email.split("@")[0]
      }-connection`;
      console.log("Creating admin user with connection:", connectionName);
      console.log("Using connection ID:", connectionId);

      // First create the user in Auth0
      const userResponse = await fetch(
        `https://${auth0Config.domain}/api/v2/users`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: JSON.stringify({
            email: tenantData.email,
            password: tenantData.password,
            name: tenantData.tenantName,
            connection: connectionName, // Use the connection name, not ID
            email_verified: true,
            app_metadata: {
              role: "admin",
              tenant_admin: true,
              tenant_slug: tenantData.slug,
              organization_id: organizationId,
            },
            user_metadata: {
              tenant_name: tenantData.tenantName,
              signup_source: "tenant_onboarding",
            },
          }),
        }
      );

      if (!userResponse.ok) {
        const errorData = await userResponse.json();
        console.error("User creation error details:", errorData);
        throw new Error(errorData.message || "Failed to create admin user");
      }

      const userData = await userResponse.json();
      console.log("Admin user created:", userData.user_id);

      // Add user to organization as admin
      const orgMembershipResponse = await fetch(
        `https://${auth0Config.domain}/api/v2/organizations/${organizationId}/members`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          body: JSON.stringify({
            members: [userData.user_id],
          }),
        }
      );

      if (!orgMembershipResponse.ok) {
        const errorData = await orgMembershipResponse.json();
        console.error("Organization membership error:", errorData);

        // Don't throw error here, just log it since user was created successfully
        console.warn(
          "User created but failed to add to organization:",
          errorData.message
        );
      } else {
        console.log("User added to organization successfully");
      }

      return {
        success: true,
        data: {
          userId: userData.user_id,
          email: userData.email,
          userName: userData.name,
        },
      };
    } catch (error) {
      logger?.error?.("Failed to create organization admin:", error);
      return {
        success: false,
        message: `Admin user creation failed: ${error.message}`,
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
