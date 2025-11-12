import mongoose from 'mongoose';
const { Schema } = mongoose;

// Discussion Schema
const DiscussionSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 200,
    },
    content: {
      type: String,
      required: true,
    },
    imageUrl: {
      type: String,
      required: false,
      default: '',
    },
    tenantUserId: {
      type: String,
      required: true,
    },
    tenantId: {
      type: String,
      required: true,
    },
    author: {
      id: { type: String, required: false },
      name: { type: String, required: false },
      email: { type: String, required: false },
      role: { type: String, required: false }
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tags: {
      type: [String],
      default: [],
    },
    likes: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    dislikes: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    views: {
      type: Number,
      default: 0,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    isPinned: {
      type: Boolean,
      default: false,
    },
    channelId: {
      type: Schema.Types.ObjectId,
      ref: 'Channel',
    },
  },
  { timestamps: true }
);

// Indexes
DiscussionSchema.index({ createdAt: -1 });
DiscussionSchema.index({ tags: 1 });
DiscussionSchema.index({ authorId: 1 });
DiscussionSchema.index({ channelId: 1, createdAt: -1 });

export default mongoose.model('Discussion', DiscussionSchema);
