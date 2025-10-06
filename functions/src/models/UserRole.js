import mongoose from 'mongoose';
const { Schema } = mongoose;

// LMS User to Role relationship Schema
const UserRoleSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    role: {
      type: Schema.Types.ObjectId,
      ref: 'Role',
      required: true,
    },
    isPrimary: {
      type: Boolean,
      default: false,
    },
    assignedAt: {
      type: Date,
      default: Date.now,
    },
    assignedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
  },
  { timestamps: true }
);

// Indexes
UserRoleSchema.index({ user: 1, role: 1 }, { unique: true });
UserRoleSchema.index({ user: 1, isPrimary: 1 });
UserRoleSchema.index({ role: 1 });

export default mongoose.model('UserRole', UserRoleSchema);
