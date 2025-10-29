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
    title: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    department: {
      type: String,
      trim: true,
      maxlength: 100,
    },
    // Lowercased copy of name for efficient case-insensitive search
    nameLower: {
      type: String,
      trim: true,
      index: true,
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
    location: {
      type: String,
      trim: true,
      maxlength: 120,
    },
    profilePicture: {
      type: String,
      trim: true,
    },
    // Auth0 profile picture URL (from Auth0 ID token)
    auth0Picture: {
      type: String,
      trim: true,
    },
    // Binary avatar storage (user uploaded)
    avatarBinary: {
      type: Buffer,
      select: false,
    },
    avatarContentType: {
      type: String,
      select: false,
    },
    // Avatar source: 'auth0', 'uploaded', or 'default'
    avatarSource: {
      type: String,
      enum: ['auth0', 'uploaded', 'default'],
      default: 'default',
    },
    coverImage: {
      type: String,
      trim: true,
    },
    skills: {
      type: [String],
      default: [],
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
    // Mention tracking - stores IDs of read mentions (format: "message:messageId" or "comment:commentId")
    readMentions: [{ type: String, default: [] }],
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
// Search-related indexes
UserSchema.index({ nameLower: 1 });
UserSchema.index({ isActive: 1, isDeleted: 1, nameLower: 1 });
UserSchema.index({ isActive: 1, isDeleted: 1, email: 1 });

// Keep nameLower in sync
UserSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.nameLower = typeof this.name === 'string' ? this.name.toLowerCase() : this.name;
  }
  next();
});

// Virtual for is_authenticated
UserSchema.virtual('is_authenticated').get(function() {
  return this.isActive && !this.isDeleted;
});

// Virtual for avatar URL - returns the best available avatar
UserSchema.virtual('avatarUrl').get(function() {
  // Priority: uploaded binary -> Auth0 picture -> profilePicture -> default
  if (this.avatarSource === 'uploaded' && this.avatarBinary) {
    return `/api/v1/users/${this._id}/avatar`; // Binary avatar endpoint
  }
  if (this.avatarSource === 'auth0' && this.auth0Picture) {
    return this.auth0Picture;
  }
  if (this.profilePicture) {
    return this.profilePicture;
  }
  return null; // Frontend can handle default avatar
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
