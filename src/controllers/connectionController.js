import Connection from '../models/Connection.js'
import mongoose from 'mongoose'
import chimeMessagingService from '../services/chimeMessagingService.js'
import { logger } from '../utils/logger.js'
import Channel from '../models/Channel.js'

class ConnectionController {
    async getAllConnections(req,res,next){
        try{
            const connections = await Connection.find({$or: [{requesterId: req.auth.userId}, {recipientId: req.auth.userId}], status:'accepted' })
            return res.status(200).json({ connections })
        }
        catch(error){
            next(error)
        }
    }
    async requestConnection(req, res, next) {
        try {
            const { recipientId, recipientName } = req.body
            if (!mongoose.Types.ObjectId.isValid(recipientId)) {
                return res.status(400).json({ error: 'Invalid recipientId' })
            }
            const existingConnection = await Connection.findOne({ requesterId: req.auth.userId, recipientId: recipientId })
            if (existingConnection) {
                return res.status(400).json({ error: 'Connection already exists' })
            }
            const newConnection = await Connection.create({
                requesterId: req.auth.userId,
                requesterName: req.auth.userName,
                recipientId: recipientId,
                recipientName: recipientName,
                status: 'sent'
            })
            return res.status(200).json({ newConnection })
        } catch (error) {
            next(error)
        }
    }
    async getPendingConnections(req, res, next) {
        try{
            // Get pending connection requests received by this user (where they are the recipient)
            const pendingConnections = await Connection.find({  requesterId: req.auth.userId, status: 'sent' })
            return res.status(200).json({ pendingConnections })
        } catch (error) {
            next(error)
        }
    }
    async getReceivedConnections(req, res, next) {
        try{
            const receivedConnections = await Connection.find({ recipientId: req.auth.userId, status: 'sent' })
            return res.status(200).json({ receivedConnections })
        } catch (error) {
            next(error)
        }
        }
    async rejectConnection(req, res, next) {
        try{
            const { connectionId } = req.body
            const connection = await Connection.findByIdAndUpdate(
                connectionId,
                { $set: { status: 'rejected' } },
                { new: true }
              )
            return res.status(200).json({ connection })
        } catch (error) {
            next(error)
        }
    }

    async acceptConnection(req, res, next) {
    try{
        const { connectionId } = req.body
        const connection = await Connection.findByIdAndUpdate(
            connectionId,
            { $set: { status: 'accepted' } },
            { new: true }
        )
        if(!connection){
            return res.status(400).json({ error: 'Connection not found' })
        }
        const channel = await chimeMessagingService.createChannel({ name: `${connection.requesterName}-${connection.recipientName}`, description: 'DM', isPrivate: true, createdByUser: connection.requesterId, isDefaultGeneral: false , from: 'connection', members: [connection.requesterId, connection.recipientId], admins: [connection.requesterId, connection.recipientId] })
        if(!channel){
            return res.status(400).json({ error: 'Failed to accept connection, failed to create channels' })
        }
        await chimeMessagingService.addMember({ channelId: channel._id, user: connection.recipientId, operatorUser: connection.requesterId })
        logger.info('[Connection] Channel created', { channel })
        const updatedConnection = await Connection.findByIdAndUpdate(connectionId, { $set: { channelId: channel._id } }, { new: true })
        return res.status(200).json({ connection: updatedConnection, channel })
    } catch (error) {
        next(error)
    }
    }
}

export default new ConnectionController()