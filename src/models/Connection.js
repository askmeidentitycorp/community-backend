import mongoose from 'mongoose'

const ConnectionSchema = new mongoose.Schema({
    requesterId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    requesterName:{
        type: String,
        required: true
    },
    recipientId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipientName:{
        type: String,
        required: true
    },
    channelId:{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Channel',
        required: false
    },
    status:{
        type: String,
    }
}, { timestamps: true })

const Connection = mongoose.model('Connection', ConnectionSchema)

export default Connection