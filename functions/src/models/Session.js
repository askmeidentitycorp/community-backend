import mongoose from 'mongoose';
const { Schema } = mongoose;

// LMS User Auth Token Schema
const SessionSchema = new Schema(
  {
    sessionId: {
      type: String,
      required: true,
      unique: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    accessTokenExpiresAt: {
      type: Date,
      required: true,
    },
    refreshTokenExpiresAt: {
      type: Date,
      required: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    deviceInfo: {
      type: Schema.Types.Mixed, // JSON field with device information
      default: {},
    },
    ipAddress: {
      type: String,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    auth0Token: {
      type: String, // Original Auth0 JWT token
    },
    auth0Subject: {
      type: String, // Auth0 user subject ID
    },
    auth0RefreshToken: {
      type: String, // Auth0 refresh token for ID token renewal
    },
    isAuth0Session: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Indexes
SessionSchema.index({ user: 1, isActive: 1 });
SessionSchema.index({ sessionId: 1 }, { unique: true });
SessionSchema.index({ accessToken: 1 });
SessionSchema.index({ refreshToken: 1 });
SessionSchema.index({ accessTokenExpiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
SessionSchema.index({ refreshTokenExpiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

// Methods
SessionSchema.methods.isAccessTokenExpired = function() {
  return new Date() > this.accessTokenExpiresAt;
};

SessionSchema.methods.isRefreshTokenExpired = function() {
  return new Date() > this.refreshTokenExpiresAt;
};

SessionSchema.methods.createTokenPair = function() {
  // This will be implemented in the service layer
  return {
    accessToken: this.accessToken,
    refreshToken: this.refreshToken,
  };
};

SessionSchema.methods.refreshAccessToken = function() {
  // This will be implemented in the service layer
  return this.accessToken;
};

SessionSchema.methods.revoke = function() {
  this.isActive = false;
  return this.save();
};

export default mongoose.model('Session', SessionSchema);
