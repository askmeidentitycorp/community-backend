  // import mongoose from "mongoose";

  // const tenantSchema = new mongoose.Schema(
  //   {
  //     tenantName: { type: String, required: true },
  //     slug: { type: String, required: true, unique: true },
  //     email: { type: String, required: true },
  //     status: {
  //       type: String,
  //       enum: ["active", "inactive", "suspended", "trial"],
  //       default: "active",
  //     },
  //     plan: {
  //       type: String,
  //       enum: ["free", "pro", "enterprise"],
  //       default: "free",
  //     },
  //     userOnboardUrl: { type: String, required: true },
  // },
  //   { timestamps: true }
  // );

  // // Optional: auto-generate onboarding URL if not provided
  // tenantSchema.pre("save", function (next) {
  //   if (!this.userOnboardUrl && this.slug) {
  //     this.userOnboardUrl = `https://${this.slug}.askmeidentity.com/onboard`;
  //   }
  //   next();
  // });

  // export const Tenant = mongoose.model("Tenant", tenantSchema);
import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema(
  {
    tenantName: { 
      type: String, 
      required: true,
      trim: true 
    },
    slug: { 
      type: String, 
      required: true, 
      unique: true,
      lowercase: true,
      trim: true
    },
    email: { 
      type: String, 
      required: true,
      trim: true,
      lowercase: true
    },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "trial", "provisioning", "failed"],
      default: "provisioning",
    },
    plan: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      default: "free",
    },
    ChimeAppInstanceArn: { 
      type: String 
    },
    ChimeBerear: { 
      type: String 
    },
    ChimeBackendAdminRoleArn: { 
      type: String 
    },
    userOnboardUrl: { 
      type: String, 
      required: true 
    },
    // Auth0 Integration Fields
    auth0: {
      organizationId: {
        type: String,
        sparse: true // Allows null for unique index
      },
      connectionId: {
        type: String,
        sparse: true
      },
      adminUserId: {
        type: String,
        sparse: true
      },
      connectionName: {
        type: String,
        sparse: true
      },
      // Track provisioning status for each component
      provisioningStatus: {
        organization: {
          type: String,
          enum: ["pending", "completed", "failed"],
          default: "pending"
        },
        connection: {
          type: String,
          enum: ["pending", "completed", "failed"],
          default: "pending"
        },
        adminUser: {
          type: String,
          enum: ["pending", "completed", "failed"],
          default: "pending"
        }
      },
      // Store any error messages during provisioning
      provisioningErrors: {
        organization: String,
        connection: String,
        adminUser: String
      }
    },
    // Additional metadata
    metadata: {
      createdAtAuth0: Date,
      lastSync: Date,
      tenantDomain: String
    }
  },
  { 
    timestamps: true 
  }
);

// Add indexes for better query performance
tenantSchema.index({ slug: 1 });
tenantSchema.index({ email: 1 });
tenantSchema.index({ "auth0.organizationId": 1 }, { sparse: true });
tenantSchema.index({ "auth0.connectionId": 1 }, { sparse: true });
tenantSchema.index({ status: 1 });

// Auto-generate onboarding URL if not provided
tenantSchema.pre("save", function (next) {
  if (!this.userOnboardUrl && this.slug) {
    this.userOnboardUrl = `https://${this.slug}.askmeidentity.com/onboard`;
  }
  
  // Auto-generate tenant domain
  if (!this.metadata?.tenantDomain && this.slug) {
    if (!this.metadata) this.metadata = {};
    this.metadata.tenantDomain = `${this.slug}.askmeidentity.com`;
  }
  
  next();
});

// Virtual for checking if Auth0 provisioning is complete
tenantSchema.virtual('isAuth0Provisioned').get(function() {
  return this.auth0?.organizationId && 
         this.auth0?.connectionId && 
         this.auth0?.adminUserId;
});

// Virtual for checking provisioning status
tenantSchema.virtual('provisioningStatus').get(function() {
  if (!this.auth0?.provisioningStatus) return 'pending';
  
  const status = this.auth0.provisioningStatus;
  if (status.organization === 'failed' || 
      status.connection === 'failed' || 
      status.adminUser === 'failed') {
    return 'failed';
  }
  if (status.organization === 'completed' && 
      status.connection === 'completed' && 
      status.adminUser === 'completed') {
    return 'completed';
  }
  return 'in_progress';
});

// Instance method to update provisioning status
tenantSchema.methods.updateProvisioningStatus = function(component, status, error = null) {
  if (!this.auth0) this.auth0 = {};
  if (!this.auth0.provisioningStatus) this.auth0.provisioningStatus = {};
  if (!this.auth0.provisioningErrors) this.auth0.provisioningErrors = {};
  
  this.auth0.provisioningStatus[component] = status;
  
  if (error) {
    this.auth0.provisioningErrors[component] = error;
  }
  
  // Update overall status based on component statuses
  if (status === 'failed') {
    this.status = 'failed';
  } else if (this.provisioningStatus === 'completed') {
    this.status = 'active';
  }
};

// Static method to find by Auth0 organization ID
tenantSchema.statics.findByOrganizationId = function(organizationId) {
  return this.findOne({ "auth0.organizationId": organizationId });
};

// Static method to find by Auth0 connection ID
tenantSchema.statics.findByConnectionId = function(connectionId) {
  return this.findOne({ "auth0.connectionId": connectionId });
};

// Static method to find active tenants
tenantSchema.statics.findActive = function() {
  return this.find({ status: 'active' });
};

export const Tenant = mongoose.model("Tenant", tenantSchema);