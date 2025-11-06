import mongoose from 'mongoose';
const { Schema } = mongoose;

// ChannelMembership Schema
const ChannelMembershipSchema = new Schema(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'Channel',
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
    },
    tenantUserLinkId: {
      type: Schema.Types.ObjectId,
      ref: 'TenantUserLink',
      required: true,
    },
    unreadCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastReadAt: {
      type: Date,
      default: Date.now,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    notificationSettings: {
      enabled: {
        type: Boolean,
        default: true,
      },
      muteUntil: {
        type: Date,
        default: null,
      },
    },
  },
  { timestamps: true }
);

// Indexes
ChannelMembershipSchema.index({ channelId: 1, userId: 1 }, { unique: true });
ChannelMembershipSchema.index({ userId: 1 });
ChannelMembershipSchema.index({ channelId: 1 });
ChannelMembershipSchema.index({ unreadCount: 1 });

export default mongoose.model('ChannelMembership', ChannelMembershipSchema);
