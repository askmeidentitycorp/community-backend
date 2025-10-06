import mongoose from 'mongoose';
const { Schema } = mongoose;

// LMS User Schema
const UserSchema = new Schema(
  {
    auth0Id: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    roles: {
      type: [String],
      enum: ['super_admin', 'moderator', 'member'],
      default: ['member'],
    },
    phone: {
      type: String,
      trim: true,
    },
    bio: {
      type: String,
      maxlength: 2000,
    },
    profilePicture: {
      type: String,
      trim: true,
    },
    timezone: {
      type: String,
      default: 'UTC',
    },
    language: {
      type: String,
      default: 'en',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    lastLogin: {
      type: Date,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    // Reaction references for profile features
    likedDiscussions: [{ type: Schema.Types.ObjectId, ref: 'Discussion', default: [] }],
    dislikedDiscussions: [{ type: Schema.Types.ObjectId, ref: 'Discussion', default: [] }],
    likedComments: [{ type: Schema.Types.ObjectId, ref: 'Comment', default: [] }],
    dislikedComments: [{ type: Schema.Types.ObjectId, ref: 'Comment', default: [] }],
  },
  { timestamps: true }
);

// Indexes
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ auth0Id: 1 }, { unique: true });
UserSchema.index({ isActive: 1, isDeleted: 1 });
UserSchema.index({ lastLogin: -1 });
UserSchema.index({ likedDiscussions: 1 });
UserSchema.index({ likedComments: 1 });

// Virtual for is_authenticated
UserSchema.virtual('is_authenticated').get(function() {
  return this.isActive && !this.isDeleted;
});

// Method to check if user has role
UserSchema.methods.hasRole = function(roleName) {
  return this.roles && this.roles.includes(roleName);
};

// Method to get primary role
UserSchema.methods.getPrimaryRole = function() {
  return this.roles && this.roles.length > 0 ? this.roles[0] : null;
};

export default mongoose.model('User', UserSchema);
