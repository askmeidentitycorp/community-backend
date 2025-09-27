import mongoose from 'mongoose';
const { Schema } = mongoose;

// LMS User Role Schema
const RoleSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      trim: true,
    },
    permissions: {
      type: Schema.Types.Mixed, // JSON field for role permissions
      default: {},
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Indexes
RoleSchema.index({ name: 1 }, { unique: true });
RoleSchema.index({ isActive: 1 });

export default mongoose.model('Role', RoleSchema);
