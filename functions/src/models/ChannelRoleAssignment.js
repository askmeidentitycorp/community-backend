import mongoose from 'mongoose';
const { Schema } = mongoose;

const ChannelRoleAssignmentSchema = new Schema(
  {
    channelId: { type: Schema.Types.ObjectId, ref: 'Channel', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, required: true, enum: ['moderator'] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

ChannelRoleAssignmentSchema.index({ channelId: 1, userId: 1, role: 1 }, { unique: true });
ChannelRoleAssignmentSchema.index({ userId: 1, role: 1 });
ChannelRoleAssignmentSchema.index({ channelId: 1, role: 1 });

export default mongoose.model('ChannelRoleAssignment', ChannelRoleAssignmentSchema);


