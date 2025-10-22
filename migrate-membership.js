import mongoose from 'mongoose';
import Channel from './src/models/Channel.js';
import ChannelMembership from './src/models/ChannelMembership.js';
import Message from './src/models/Message.js';
import User from './src/models/User.js';

/**
 * Migration script to transfer existing channel memberships to ChannelMembership collection
 * and initialize unread counts based on existing messages
 */
async function migrateChannelMemberships() {
  try {
    console.log('🚀 Starting channel membership migration...');
    
    // Connect to MongoDB with proper database name
    const tenantId = process.env.TENANT_ID || 'tenant1';
    const databaseName = process.env.MONGODB_DATABASE || `community_db_ami`;
    const MONGODB_URI = process.env.MONGODB_URI || '';
    await mongoose.connect(MONGODB_URI, { dbName: databaseName });
    console.log('✅ Connected to MongoDB');

    // Get all channels with members
    const channels = await Channel.find({ 
      members: { $exists: true, $not: { $size: 0 } } 
    }).populate('members', '_id');

    console.log(`📊 Found ${channels.length} channels with members`);

    let totalMemberships = 0;
    let totalUnreadCounts = 0;

    for (const channel of channels) {
      console.log(`\n📝 Processing channel: ${channel.name} (${channel._id})`);
      
      // Get the latest message timestamp for this channel
      const latestMessage = await Message.findOne({ channelId: channel._id })
        .sort({ createdAt: -1 })
        .select('createdAt');
      
      const lastMessageAt = latestMessage?.createdAt || channel.createdAt;

      // Create memberships for all current members
      const membershipPromises = channel.members.map(async (member) => {
        try {
          // Check if membership already exists
          const existingMembership = await ChannelMembership.findOne({
            channelId: channel._id,
            userId: member._id
          });

          if (existingMembership) {
            console.log(`  ⚠️  Membership already exists for user ${member._id}`);
            return existingMembership;
          }

          // Count unread messages for this user
          // Consider messages after channel creation as potentially unread
          // In a real scenario, you might want to be more sophisticated about this
          const unreadCount = await Message.countDocuments({
            channelId: channel._id,
            authorId: { $ne: member._id }, // Don't count own messages
            createdAt: { $gte: channel.createdAt }
          });

          const membership = await ChannelMembership.create({
            channelId: channel._id,
            userId: member._id,
            unreadCount: Math.min(unreadCount, 99), // Cap at 99 for UI display
            lastReadAt: channel.createdAt, // Initialize to channel creation time
            lastMessageAt: lastMessageAt,
            joinedAt: channel.createdAt, // Approximate join time
            isActive: false,
            notificationSettings: {
              enabled: true,
              muteUntil: null
            }
          });

          console.log(`  ✅ Created membership for user ${member._id} with ${membership.unreadCount} unread messages`);
          totalMemberships++;
          totalUnreadCounts += membership.unreadCount;
          
          return membership;
        } catch (error) {
          console.error(`  ❌ Error creating membership for user ${member._id}:`, error.message);
          return null;
        }
      });

      await Promise.all(membershipPromises);
    }

    console.log('\n📈 Migration Summary:');
    console.log(`  - Total memberships created: ${totalMemberships}`);
    console.log(`  - Total unread counts initialized: ${totalUnreadCounts}`);
    console.log(`  - Channels processed: ${channels.length}`);

    // Verify migration
    const membershipCount = await ChannelMembership.countDocuments();
    console.log(`\n🔍 Verification: ${membershipCount} total memberships in database`);

    // Show sample of created memberships
    const sampleMemberships = await ChannelMembership.find()
      .populate('channelId', 'name')
      .populate('userId', 'name email')
      .limit(5);
    
    console.log('\n📋 Sample memberships:');
    sampleMemberships.forEach(membership => {
      console.log(`  - ${membership.userId?.name} in ${membership.channelId?.name}: ${membership.unreadCount} unread`);
    });

    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

/**
 * Rollback function to remove all ChannelMembership documents
 * Use with caution - this will delete all unread count data
 */
async function rollbackMigration() {
  try {
    console.log('🔄 Starting migration rollback...');
    
    const databaseName = process.env.MONGODB_DATABASE || `community_db_ami`;
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://support_db_user:BSfPX9M5bcs3Sbm4@cluster0.wchofks.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
    await mongoose.connect(MONGODB_URI, { dbName: databaseName });
    console.log('✅ Connected to MongoDB');

    const result = await ChannelMembership.deleteMany({});
    console.log(`🗑️  Deleted ${result.deletedCount} membership documents`);

    console.log('✅ Rollback completed successfully!');
    
  } catch (error) {
    console.error('❌ Rollback failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run migration if this script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];
  
  if (command === 'rollback') {
    rollbackMigration()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    migrateChannelMemberships()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  }
}

export { migrateChannelMemberships, rollbackMigration };
