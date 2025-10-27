import mongoose from 'mongoose';
const { Schema } = mongoose;

// Comment Schema
const CommentSchema = new Schema(
  {
    discussionId: {
      type: Schema.Types.ObjectId,
      ref: 'Discussion',
      required: true,
    },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: 'Comment',
    },
    authorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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
    isEdited: {
      type: Boolean,
      default: false,
    },
    mentions: {
      type: [Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
  },
  { timestamps: true }
);

// Indexes
CommentSchema.index({ discussionId: 1, createdAt: 1 });
CommentSchema.index({ parentId: 1 });
CommentSchema.index({ mentions: 1 });

export default mongoose.model('Comment', CommentSchema);
