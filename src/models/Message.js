import mongoose from 'mongoose';
const { Schema } = mongoose;

// Message Schema
const MessageSchema = new Schema(
  {
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'Channel',
      required: true,
    },
    authorId: {
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
    content: {
      type: String,
      required: true,
    },
    attachments: {
      type: [String],
      default: [],
    },
    mentions: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    isEdited: {
      type: Boolean,
      default: false,
    },
    isRedacted: {
      type: Boolean,
      default: false,
    },
    redactedAt: {
      type: Date,
      default: null,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
    // Fixed reaction set stored as user arrays; counts = array lengths
    reactions: {
      like: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      love: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      laugh: [{ type: Schema.Types.ObjectId, ref: 'User' }],
      wow: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    },
  },
  { timestamps: true }
);

// Indexes
MessageSchema.index({ channelId: 1, createdAt: 1 });
MessageSchema.index({ mentions: 1 });
// External provider mapping (Chime message id)
MessageSchema.add({
  externalRef: {
    provider: { type: String, default: 'local' }, // 'chime' when synced to Chime
    messageId: { type: String }, // Chime MessageId
    channelArn: { type: String } // Chime ChannelArn
  }
});
MessageSchema.index({ 'externalRef.provider': 1, 'externalRef.messageId': 1 }, { unique: false, sparse: true });

export default mongoose.model('Message', MessageSchema);
