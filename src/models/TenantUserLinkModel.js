
import mongoose from "mongoose";

const TenantUserLinkSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["owner", "admin", "member", "guest","super-admin"],
      default: "member",
    },
    status: {
      type: String,
      enum: ["active", "invited", "suspended", "removed"],
      default: "active",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    lastActiveAt: {
      type: Date,
    },
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    metadata: {
      type: Map,
      of: mongoose.Schema.Types.Mixed, 
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate membership of same user in same tenant
TenantUserLinkSchema.index({ tenantId: 1, userId: 1 }, { unique: true });

// Quick lookups
TenantUserLinkSchema.index({ tenantId: 1 });
TenantUserLinkSchema.index({ userId: 1 });

export const TenantUserLink = mongoose.model("TenantUserLink", TenantUserLinkSchema);
