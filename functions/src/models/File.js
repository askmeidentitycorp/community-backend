import mongoose from 'mongoose';
const { Schema } = mongoose;

// File Schema
const FileSchema = new Schema(
  {
    filename: {
      type: String,
      required: true,
    },
    originalName: {
      type: String,
      required: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    size: {
      type: Number,
      required: true,
    },
    path: {
      type: String,
      required: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    discussionId: {
      type: Schema.Types.ObjectId,
      ref: 'Discussion',
    },
    messageId: {
      type: Schema.Types.ObjectId,
      ref: 'Message',
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// Indexes
FileSchema.index({ uploadedBy: 1 });
FileSchema.index({ mimeType: 1 });
FileSchema.index({ discussionId: 1 });
FileSchema.index({ messageId: 1 });

export default mongoose.model('File', FileSchema);
