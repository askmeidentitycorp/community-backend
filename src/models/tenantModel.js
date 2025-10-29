import mongoose from "mongoose";

const tenantSchema = new mongoose.Schema(
  {
    tenantName: { type: String, required: true },
    slug: { type: String, required: true, unique: true },
    email: { type: String, required: true },
    status: {
      type: String,
      enum: ["active", "inactive", "suspended", "trial"],
      default: "active",
    },
    plan: {
      type: String,
      enum: ["free", "pro", "enterprise"],
      default: "free",
    },
    userOnboardUrl: { type: String, required: true },
 },
  { timestamps: true }
);

// Optional: auto-generate onboarding URL if not provided
tenantSchema.pre("save", function (next) {
  if (!this.userOnboardUrl && this.slug) {
    this.userOnboardUrl = `https://${this.slug}.askmeidentity.com/onboard`;
  }
  next();
});

export const Tenant = mongoose.model("Tenant", tenantSchema);
