import ChannelMembership from '../models/ChannelMembership.js';
import Channel from '../models/Channel.js';
import Message from '../models/Message.js';
import mongoose from 'mongoose';

/**
 * Service for managing unread message counts per user per channel
 */
class UnreadCountService {
  
  /**
   * Increment unread count for all channel members except the sender
   * @param {string} channelId - The channel ID
   * @param {string} senderId - The ID of the user who sent the message
   * @param {Object} options - Additional options
   * @param {string} options.messageId - The message ID for logging
   * @param {string} options.messageContent - Message content for debugging
   */
  static async incrementUnreadCount(channelId, senderId, options = {}) {
    try {
      console.log('[UnreadCountService] incrementUnreadCount start', { 
        channelId, 
        senderId, 
        messageId: options.messageId 
      });

      // Get all channel members except the sender
      const channel = await Channel.findById(channelId).select('members');
      if (!channel) {
        throw new Error(`Channel ${channelId} not found`);
      }

      const memberIds = channel.members
        .map(id => id.toString())
        .filter(id => id !== senderId);

      if (memberIds.length === 0) {
        console.log('[UnreadCountService] No members to update for channel', { channelId });
        return;
      }

      // Update unread counts for all members except sender
      const updateResult = await ChannelMembership.updateMany(
        { 
          channelId: new mongoose.Types.ObjectId(channelId),
          userId: { $in: memberIds.map(id => new mongoose.Types.ObjectId(id)) }
        },
        { 
          $inc: { unreadCount: 1 },
          $set: { lastMessageAt: new Date() }
        }
      );

      console.log('[UnreadCountService] incrementUnreadCount success', {
        channelId,
        senderId,
        membersUpdated: updateResult.modifiedCount,
        messageId: options.messageId
      });

      return updateResult;
    } catch (error) {
      console.error('[UnreadCountService] incrementUnreadCount error', {
        channelId,
        senderId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Mark a channel as read for a specific user
   * @param {string} channelId - The channel ID
   * @param {string} userId - The user ID
   * @returns {Object} Updated membership with unread count
   */
  static async markAsRead(channelId, userId) {
    try {
      console.log('[UnreadCountService] markAsRead start', { channelId, userId });

      const membership = await ChannelMembership.findOneAndUpdate(
        { 
          channelId: new mongoose.Types.ObjectId(channelId),
          userId: new mongoose.Types.ObjectId(userId)
        },
        { 
          $set: { 
            unreadCount: 0,
            lastReadAt: new Date()
          }
        },
        { 
          new: true,
          upsert: false // Don't create if doesn't exist
        }
      );

      if (!membership) {
        console.log('[UnreadCountService] No membership found, creating default', { channelId, userId });
        
        // Create a default membership if it doesn't exist
        const newMembership = await ChannelMembership.create({
          channelId: new mongoose.Types.ObjectId(channelId),
          userId: new mongoose.Types.ObjectId(userId),
          unreadCount: 0,
          lastReadAt: new Date(),
          lastMessageAt: new Date(),
          joinedAt: new Date(),
          isActive: true,
          notificationSettings: {
            enabled: true,
            muteUntil: null
          }
        });

        console.log('[UnreadCountService] markAsRead success (created)', { 
          channelId, 
          userId,
          unreadCount: newMembership.unreadCount 
        });

        return newMembership;
      }

      console.log('[UnreadCountService] markAsRead success', { 
        channelId, 
        userId,
        unreadCount: membership.unreadCount 
      });

      return membership;
    } catch (error) {
      console.error('[UnreadCountService] markAsRead error', {
        channelId,
        userId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Get unread count for a specific user in a specific channel
   * @param {string} channelId - The channel ID
   * @param {string} userId - The user ID
   * @returns {number} Unread count
   */
  static async getUnreadCount(channelId, userId) {
    try {
      const membership = await ChannelMembership.findOne({
        channelId: new mongoose.Types.ObjectId(channelId),
        userId: new mongoose.Types.ObjectId(userId)
      }).select('unreadCount');

      return membership?.unreadCount || 0;
    } catch (error) {
      console.error('[UnreadCountService] getUnreadCount error', {
        channelId,
        userId,
        error: error.message
      });
      return 0; // Return 0 on error to avoid breaking the UI
    }
  }

  /**
   * Get unread summary for a user across all channels
   * @param {string} userId - The user ID
   * @returns {Array} Array of objects with channelId and unreadCount
   */
  static async getUserUnreadSummary(userId) {
    try {
      console.log('[UnreadCountService] getUserUnreadSummary start', { userId });

      const memberships = await ChannelMembership.find({
        userId: new mongoose.Types.ObjectId(userId),
        unreadCount: { $gt: 0 } // Only return channels with unread messages
      }).select('channelId unreadCount lastReadAt lastMessageAt').lean();

      const summary = memberships.map(membership => ({
        channelId: membership.channelId.toString(),
        unreadCount: membership.unreadCount,
        lastReadAt: membership.lastReadAt,
        lastMessageAt: membership.lastMessageAt
      }));

      console.log('[UnreadCountService] getUserUnreadSummary success', { 
        userId,
        channelCount: summary.length,
        totalUnread: summary.reduce((sum, item) => sum + item.unreadCount, 0)
      });

      return summary;
    } catch (error) {
      console.error('[UnreadCountService] getUserUnreadSummary error', {
        userId,
        error: error.message,
        stack: error.stack
      });
      return []; // Return empty array on error
    }
  }

  /**
   * Ensure unread count tracking exists for a user in a channel
   * This should be called when a user joins a channel (called from chimeMessagingService.addMember)
   * @param {string} channelId - The channel ID
   * @param {string} userId - The user ID
   * @param {Object} options - Additional options
   * @returns {Object} Created or existing membership
   */
  static async ensureUnreadTracking(channelId, userId, tenantId, tenantUserLinkId, options = {}) {
    try {
      console.log('[UnreadCountService] ensureUnreadTracking start', { channelId, userId });

      // Check if membership already exists
      const existing = await ChannelMembership.findOne({
        channelId: new mongoose.Types.ObjectId(channelId),
        userId: new mongoose.Types.ObjectId(userId)
      });

      if (existing) {
        console.log('[UnreadCountService] Unread tracking already exists', { channelId, userId });
        return existing;
      }

      // Get the latest message timestamp for this channel
      const latestMessage = await Message.findOne({ channelId: new mongoose.Types.ObjectId(channelId) })
        .sort({ createdAt: -1 })
        .select('createdAt');

      const lastMessageAt = latestMessage?.createdAt || new Date();

      const membership = await ChannelMembership.create({
        channelId: new mongoose.Types.ObjectId(channelId),
        userId: new mongoose.Types.ObjectId(userId),
        tenantId: new mongoose.Types.ObjectId(tenantId),
        tenantUserLinkId: new mongoose.Types.ObjectId(tenantUserLinkId),
        unreadCount: 0, // Start with 0 unread messages
        lastReadAt: new Date(), // Mark as read when joining
        lastMessageAt: lastMessageAt,
        joinedAt: new Date(),
        isActive: true,
        notificationSettings: {
          enabled: true,
          muteUntil: null
        }
      });

      console.log('[UnreadCountService] ensureUnreadTracking success', { 
        channelId, 
        userId,
        membershipId: membership._id 
      });

      return membership;
    } catch (error) {
      console.error('[UnreadCountService] ensureUnreadTracking error', {
        channelId,
        userId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Clean up unread count tracking when a user leaves a channel
   * This should be called when a user leaves a channel (called from channelController.removeMember)
   * @param {string} channelId - The channel ID
   * @param {string} userId - The user ID
   * @returns {boolean} Success status
   */
  static async cleanupUnreadTracking(channelId, userId) {
    try {
      console.log('[UnreadCountService] cleanupUnreadTracking start', { channelId, userId });

      const result = await ChannelMembership.deleteOne({
        channelId: new mongoose.Types.ObjectId(channelId),
        userId: new mongoose.Types.ObjectId(userId)
      });

      console.log('[UnreadCountService] cleanupUnreadTracking success', { 
        channelId, 
        userId,
        deleted: result.deletedCount > 0 
      });

      return result.deletedCount > 0;
    } catch (error) {
      console.error('[UnreadCountService] cleanupUnreadTracking error', {
        channelId,
        userId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Update notification settings for a user's channel membership
   * @param {string} channelId - The channel ID
   * @param {string} userId - The user ID
   * @param {Object} settings - Notification settings
   * @returns {Object} Updated membership
   */
  static async updateNotificationSettings(channelId, userId, settings) {
    try {
      console.log('[UnreadCountService] updateNotificationSettings start', { 
        channelId, 
        userId, 
        settings 
      });

      const membership = await ChannelMembership.findOneAndUpdate(
        { 
          channelId: new mongoose.Types.ObjectId(channelId),
          userId: new mongoose.Types.ObjectId(userId)
        },
        { 
          $set: { 
            notificationSettings: {
              enabled: settings.enabled !== undefined ? settings.enabled : true,
              muteUntil: settings.muteUntil || null
            }
          }
        },
        { new: true }
      );

      if (!membership) {
        throw new Error('Membership not found');
      }

      console.log('[UnreadCountService] updateNotificationSettings success', { 
        channelId, 
        userId 
      });

      return membership;
    } catch (error) {
      console.error('[UnreadCountService] updateNotificationSettings error', {
        channelId,
        userId,
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }
}

export default UnreadCountService;
