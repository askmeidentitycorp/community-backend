import mongoose from 'mongoose';
const { Schema } = mongoose;

// Channel Schema
const ChannelSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    tenantId: {
      type: String,
      required: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
    },
    isPrivate: {
      type: Boolean,
      default: false,
    },
    members: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    admins: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    source: {
      system: String,
      externalCourseId: String,
      metadata: Schema.Types.Mixed,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    isDefaultGeneral: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true }
);

// Indexes
ChannelSchema.index({ name: 1 });
ChannelSchema.index({ members: 1 });
ChannelSchema.index({ 'source.system': 1, 'source.externalCourseId': 1 }, 
  { 
    unique: true, 
    partialFilterExpression: { 'source.externalCourseId': { $type: 'string' } }
  }
);
// Chime mapping index (optional)
// Note: Schema field added below via add() to avoid breaking existing code paths
ChannelSchema.add({
  chime: {
    channelArn: { type: String },
    mode: { type: String }, // RESTRICTED | UNRESTRICTED
    privacy: { type: String }, // PRIVATE | PUBLIC
    type: { type: String, default: 'channel' } // channel | dm
  }
});
ChannelSchema.index({ 'chime.channelArn': 1 }, { unique: false, sparse: true });

export default mongoose.model('Channel', ChannelSchema);
