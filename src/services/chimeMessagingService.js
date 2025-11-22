import {
  ChimeSDKMessagingClient,
  CreateChannelCommand,
  CreateChannelMembershipCommand,
  ListChannelMessagesCommand,
  SendChannelMessageCommand,
  DescribeChannelCommand,
  ListChannelsCommand,
  ListChannelMembershipsCommand,
  CreateChannelModeratorCommand,
  DeleteChannelModeratorCommand,
  DeleteChannelMembershipCommand,
  DeleteChannelCommand,
  DeleteChannelMessageCommand,
  RedactChannelMessageCommand,
} from "@aws-sdk/client-chime-sdk-messaging";
import {
  ChimeSDKIdentityClient,
  CreateAppInstanceUserCommand,
  DescribeAppInstanceUserCommand,
  CreateAppInstanceAdminCommand,
} from "@aws-sdk/client-chime-sdk-identity";
import Channel from "../models/Channel.js";
import Message from "../models/Message.js";
import { logger } from "../utils/logger.js";
import { Tenant } from "../models/tenantModel.js";
import { TenantUserLink } from "../models/TenantUserLinkModel.js";

const REGION = process.env.AWS_REGION;

if (!REGION) {
  // eslint-disable-next-line no-console
  console.warn(
    "[Chime] Missing AWS_REGION. Chime service will be disabled until configured."
  );
}

// Debug: Log AWS configuration
console.log("[Chime] AWS Configuration:", {
  region: REGION,
  hasAwsAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
  hasAwsSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
  hasAwsSessionToken: !!process.env.AWS_SESSION_TOKEN,
});

// Debug: Check what AWS identity the backend is using
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
const stsClient = new STSClient({ region: REGION });
stsClient
  .send(new GetCallerIdentityCommand({}))
  .then((identity) => {
    console.log("[Chime] Backend AWS Identity:", {
      account: identity?.Account,
      arn: identity?.Arn,
      userId: identity?.UserId,
    });
  })
  .catch((err) => {
    console.log("[Chime] Failed to get AWS identity:", err.message);
  });

// Admin clients (use backend IAM role with full permissions)
const adminIdentityClient = new ChimeSDKIdentityClient({ region: REGION });
const adminMessagingClient = new ChimeSDKMessagingClient({ region: REGION });

// User client (for operations that should use user's ChimeBearer)
const userMessagingClient = new ChimeSDKMessagingClient({ region: REGION });

// Legacy clients for backward compatibility (will be deprecated)
const identityClient = adminIdentityClient;
const messagingClient = adminMessagingClient;

function toAppInstanceUserId(userId) {
  return String(userId);
}

/**
 * CRITICAL: Fetch tenant-specific Chime configuration for a user
 * This function ALWAYS fetches fresh tenant data from the database
 * and NEVER falls back to process.env values
 * 
 * This ensures all Chime operations use proper tenant-specific configuration
 * regardless of which flow called them (auth, connection request, etc.)
 * 
 * @param {Object} user - User object with _id (required)
 * @returns {Object} - Tenant and Chime configuration
 * @throws {Error} - If user has no active tenant or tenant lacks Chime config
 */
async function getTenantChimeConfig(user) {
  if (!user || !user._id) {
    const error = new Error("User object with _id is required for Chime operations");
    logger.error("[Chime] Invalid user provided to getTenantChimeConfig", {
      hasUser: !!user,
      hasUserId: !!user?._id,
    });
    throw error;
  }

  logger.info("[Chime] Fetching tenant Chime config from database", {
    userId: user._id?.toString(),
  });

  // ALWAYS fetch from database - never use cached or passed-in values
  // Find the user's active tenant link (most recent active one)
  const tenantUserLink = await TenantUserLink.findOne({
    userId: user._id.toString(),
    status: "active",
  }).sort({ createdAt: -1 });

  if (!tenantUserLink) {
    const error = new Error(
      `No active tenant found for user ${user._id}. User must belong to an active tenant to use Chime.`
    );
    logger.error("[Chime] No active tenant link found", {
      userId: user._id?.toString(),
    });
    throw error;
  }

  // Fetch tenant details from database
  const tenant = await Tenant.findById(tenantUserLink.tenantId);

  if (!tenant) {
    const error = new Error(
      `Tenant not found for ID: ${tenantUserLink.tenantId}`
    );
    logger.error("[Chime] Tenant not found in database", {
      tenantId: tenantUserLink.tenantId,
      userId: user._id?.toString(),
    });
    throw error;
  }

  // STRICT: Validate tenant has Chime configuration - NO fallbacks
  if (!tenant.ChimeAppInstanceArn) {
    const error = new Error(
      `Tenant "${tenant.tenantName}" (${tenant._id}) does not have Chime configuration. Please configure ChimeAppInstanceArn for this tenant before using Chime features.`
    );
    logger.error("[Chime] Tenant missing required Chime configuration", {
      tenantId: tenant._id.toString(),
      tenantName: tenant.tenantName,
      hasChimeAppInstanceArn: false,
    });
    throw error;
  }

  const config = {
    tenantId: tenant._id.toString(),
    tenantUserLinkId: tenantUserLink._id.toString(),
    chimeAppInstanceArn: tenant.ChimeAppInstanceArn,
    chimeBearer: tenant.ChimeBerear || "",
    chimeBackendAdminRoleArn: tenant.ChimeBackendAdminRoleArn || "",
    tenantName: tenant.tenantName,
    tenantSlug: tenant.slug,
  };

  logger.info("[Chime] Tenant Chime config fetched successfully", {
    tenantId: config.tenantId,
    tenantName: config.tenantName,
    tenantSlug: config.tenantSlug,
    hasAppInstanceArn: !!config.chimeAppInstanceArn,
    hasBearer: !!config.chimeBearer,
    hasBackendAdminRole: !!config.chimeBackendAdminRoleArn,
  });

  return config;
}

/**
 * DEPRECATED: Legacy wrapper for backward compatibility
 * Use getTenantChimeConfig instead
 */
async function fetchTenantChimeConfig(user, providedUserDetails = {}) {
  logger.warn("[Chime] fetchTenantChimeConfig is deprecated, use getTenantChimeConfig instead");
  return getTenantChimeConfig(user);
}

async function ensureAppInstanceUser(user, userDetails = {}) {
  logger.info("[Chime] ensureAppInstanceUser start", {
    userId: user._id,
    userName: user.name,
  });
  
  if (!user) throw new Error("User is required");
  
  // ALWAYS fetch fresh tenant-specific Chime config from database
  // Ignore passed-in userDetails to ensure consistency
  const config = await getTenantChimeConfig(user);
  const APP_INSTANCE_ARN = config.chimeAppInstanceArn;
  
  const appInstanceUserId = toAppInstanceUserId(user._id);
  const appInstanceUserArn = `${APP_INSTANCE_ARN}/user/${appInstanceUserId}`;
  logger.info("[Chime] AppInstanceUser ARN", { 
    appInstanceUserArn,
    tenantId: config.tenantId,
    tenantName: config.tenantName,
  });

  try {
    await adminIdentityClient.send(
      new DescribeAppInstanceUserCommand({
        AppInstanceUserArn: appInstanceUserArn,
      })
    );
    logger.info("[Chime] AppInstanceUser already exists", {
      appInstanceUserArn,
    });
    return appInstanceUserArn;
  } catch (err) {
    // AWS Chime SDK returns ForbiddenException when user doesn't exist, not NotFoundException
    if (
      err?.name !== "NotFoundException" &&
      err?.name !== "ForbiddenException"
    ) {
      logger.error("[Chime] Error describing AppInstanceUser", {
        error: err.message,
        appInstanceUserArn,
      });
      throw err;
    }
    logger.info("[Chime] Creating new AppInstanceUser", {
      appInstanceUserArn,
      errorName: err?.name,
    });
    await adminIdentityClient.send(
      new CreateAppInstanceUserCommand({
        AppInstanceArn: APP_INSTANCE_ARN,
        AppInstanceUserId: appInstanceUserId,
        Name: user.name || user.email || appInstanceUserId,
        // Metadata must be a JSON string, not an object
        Metadata: JSON.stringify({
          Auth0Id: user.auth0Id,
          Email: user.email
        }),
      })
    );
    logger.info("[Chime] AppInstanceUser created successfully", {
      appInstanceUserArn,
    });
    return appInstanceUserArn;
  }
}

async function promoteToAppInstanceAdmin(user, userDetails = {}) {
  logger.info("[Chime] promoteToAppInstanceAdmin start", {
    userId: user._id,
    userName: user.name,
  });
  
  if (!user) throw new Error("User is required");
  
  // ALWAYS fetch fresh tenant-specific Chime config from database
  const config = await getTenantChimeConfig(user);
  const APP_INSTANCE_ARN = config.chimeAppInstanceArn;

  try {
    // Ensure the AppInstanceUser exists first
    const appInstanceUserArn = await ensureAppInstanceUser(user);

    // Promote the user to AppInstanceAdmin
    logger.info("[Chime] Promoting user to AppInstanceAdmin", {
      appInstanceUserArn,
      userName: user.name,
      tenantId: config.tenantId,
      tenantName: config.tenantName,
    });
    await adminIdentityClient.send(
      new CreateAppInstanceAdminCommand({
        AppInstanceAdminArn: appInstanceUserArn,
        AppInstanceArn: APP_INSTANCE_ARN,
      })
    );

    logger.info("[Chime] User promoted to AppInstanceAdmin successfully", {
      appInstanceUserArn,
    });
    return true;
  } catch (error) {
    // If the user is already an admin, that's okay
    if (error.name === "ConflictException") {
      logger.info("[Chime] User is already an AppInstanceAdmin", {
        userId: user._id,
        userName: user.name,
      });
      return true;
    }
    logger.error("[Chime] Error promoting user to AppInstanceAdmin", {
      error: error.message,
      errorName: error.name,
      userId: user._id,
    });
    throw error;
  }
}

async function checkChannelExistsInChime({
  name,
  isDefaultGeneral = false,
  user,
  userDetails = {},
}) {
  logger.info("[Chime] checkChannelExistsInChime start", {
    name,
    isDefaultGeneral,
    userId: user._id,
  });
  
  // ALWAYS fetch fresh tenant-specific Chime config from database
  const config = await getTenantChimeConfig(user);
  const APP_INSTANCE_ARN = config.chimeAppInstanceArn;

  try {
    // Ensure we have a valid user ARN for ChimeBearer
    const userArn = await ensureAppInstanceUser(user);
    logger.info("[Chime] Using user ARN as ChimeBearer (listChannels)", {
      chimeBearer: userArn,
      tenantId: config.tenantId,
      tenantName: config.tenantName,
    });

    // List all channels in the app instance to find one with matching name
    const listChannelsCommand = new ListChannelsCommand({
      AppInstanceArn: APP_INSTANCE_ARN,
      MaxResults: 50,
      ChimeBearer: userArn,
    });

    const response = await adminMessagingClient.send(listChannelsCommand);
    const channels = response.Channels || [];

    // Look for a channel with the same name
    const existingChannel = channels.find(
      (channel) =>
        channel.Name === name &&
        (isDefaultGeneral
          ? channel.Metadata?.includes("isDefaultGeneral")
          : true)
    );

    if (existingChannel) {
      logger.info("[Chime] Channel found in Chime", {
        channelArn: existingChannel.ChannelArn,
        name: existingChannel.Name,
      });
      return existingChannel;
    }

    logger.info("[Chime] Channel not found in Chime", { name });
    return null;
  } catch (error) {
    logger.error("[Chime] Error checking channel existence in Chime", {
      error: error.message,
    });
    throw error;
  }
}

async function getChannelMembersFromChime({ channelArn, userArn }) {
  logger.info("[Chime] getChannelMembersFromChime start", { channelArn });

  try {
    const response = await adminMessagingClient.send(
      new ListChannelMembershipsCommand({
        ChannelArn: channelArn,
        ChimeBearer: userArn,
        MaxResults: 50,
      })
    );

    const memberships = response.ChannelMemberships || [];
    logger.info("[Chime] Retrieved channel memberships from Chime", {
      count: memberships.length,
      channelArn,
    });

    return memberships;
  } catch (error) {
    logger.error("[Chime] Error getting channel memberships from Chime", {
      error: error.message,
      channelArn,
    });
    throw error;
  }
}

async function mapChimeUserArnToMongoUserId({ userArn }) {
  // Extract user ID from ARN: arn:aws:chime:region:account:app-instance/app-instance-id/user/userId
  const arnParts = userArn.split("/");
  const chimeUserId = arnParts[arnParts.length - 1];

  // Find user in MongoDB by the Chime user ID (which is our MongoDB user._id)
  const User = (await import("../models/User.js")).default;
  const user = await User.findById(chimeUserId);

  if (user) {
    logger.info("[Chime] Mapped Chime user ARN to MongoDB user", {
      userArn,
      mongoUserId: user._id,
      userName: user.name,
    });
    return user._id;
  } else {
    logger.warn("[Chime] Could not find MongoDB user for Chime ARN", {
      userArn,
      chimeUserId,
    });
    return null;
  }
}

async function syncChannelFromChime({ chimeChannel, createdByUser }) {
  logger.info("[Chime] syncChannelFromChime start", {
    channelArn: chimeChannel.ChannelArn,
    name: chimeChannel.Name,
  });

  // Check if channel already exists in MongoDB
  let channel = await Channel.findOne({
    "chime.channelArn": chimeChannel.ChannelArn,
  });

  if (channel) {
    logger.info("[Chime] Channel already synced to MongoDB", {
      channelId: channel._id,
    });
    return channel;
  }

  // Get all members from Chime
  const creatorArn = await ensureAppInstanceUser(createdByUser);
  const chimeMemberships = await getChannelMembersFromChime({
    channelArn: chimeChannel.ChannelArn,
    userArn: creatorArn,
  });

  // Map Chime user ARNs to MongoDB user IDs
  const memberIds = [];
  const adminIds = [];

  for (const membership of chimeMemberships) {
    const mongoUserId = await mapChimeUserArnToMongoUserId({
      userArn: membership.Member.Arn,
    });

    if (mongoUserId) {
      memberIds.push(mongoUserId);

      // If it's the channel creator or has admin privileges, add to admins
      if (membership.Member.Arn === creatorArn || membership.Type === "ADMIN") {
        adminIds.push(mongoUserId);
      }
    }
  }

  // Ensure the current user is included (in case they're not in Chime yet)
  if (!memberIds.includes(createdByUser._id)) {
    memberIds.push(createdByUser._id);
  }
  if (!adminIds.includes(createdByUser._id)) {
    adminIds.push(createdByUser._id);
  }

  logger.info("[Chime] Synced membership data from Chime", {
    totalMembers: memberIds.length,
    totalAdmins: adminIds.length,
    memberIds: memberIds.slice(0, 5), // Log first 5 for debugging
    adminIds: adminIds.slice(0, 5),
  });

  // Create new channel in MongoDB based on Chime data
  const channelData = {
    name: chimeChannel.Name,
    description: chimeChannel.Metadata
      ? JSON.parse(chimeChannel.Metadata).description
      : "",
    isPrivate: chimeChannel.Privacy === "PRIVATE",
    members: memberIds,
    admins: adminIds,
    createdBy: createdByUser._id,
    isDefaultGeneral:
      chimeChannel.Metadata?.includes("isDefaultGeneral") || false,
    chime: {
      channelArn: chimeChannel.ChannelArn,
      mode: chimeChannel.Mode,
      privacy: chimeChannel.Privacy,
      type: "channel",
    },
  };

  channel = await Channel.create(channelData);
  logger.info(
    "[Chime] Channel synced to MongoDB with complete membership data",
    {
      channelId: channel._id,
      membersCount: channel.members.length,
      adminsCount: channel.admins.length,
    }
  );

  return channel;
}

async function createChannel({
  name,
  description,
  topic,
  isPrivate,
  createdByUser,
  isDefaultGeneral = false, 
  from = null, 
  members = [], 
  admins = [],
  userDetails = {},
}) {
  logger.info("[Chime] createChannel start", {
    name,
    isDefaultGeneral,
    createdByUser: createdByUser._id,
  });
  
  // ALWAYS fetch fresh tenant-specific Chime config from database
  const config = await getTenantChimeConfig(createdByUser);
  const APP_INSTANCE_ARN = config.chimeAppInstanceArn;

  // First, check if channel already exists in Chime
  const existingChimeChannel = await checkChannelExistsInChime({
    name,
    isDefaultGeneral,
    user: createdByUser,
  });

  if (existingChimeChannel) {
    logger.info("[Chime] Channel already exists in Chime, syncing to MongoDB", {
      channelArn: existingChimeChannel.ChannelArn,
      tenantId: config.tenantId,
    });
    return await syncChannelFromChime({
      chimeChannel: existingChimeChannel,
      createdByUser,
    });
  }

  // Channel doesn't exist in Chime, create it
  const creatorArn = await ensureAppInstanceUser(createdByUser);
  const privacy = isPrivate ? "PRIVATE" : "PUBLIC";
  logger.info("[Chime] Creating new Chime channel", {
    name,
    privacy,
    creatorArn,
    tenantId: config.tenantId,
    tenantName: config.tenantName,
  });

  const res = await adminMessagingClient.send(
    new CreateChannelCommand({
      AppInstanceArn: APP_INSTANCE_ARN,
      Name: name,
      Mode: "RESTRICTED",
      Privacy: privacy,
      ChimeBearer: creatorArn ,
      Metadata: description
        ? JSON.stringify({ description, isDefaultGeneral })
        : isDefaultGeneral
        ? JSON.stringify({ isDefaultGeneral: true })
        : undefined,
    })
  );
  const channelArn = res.ChannelArn;
  logger.info("[Chime] Chime channel created", { channelArn });

  // Ensure topic is an array format with valid hex colors
  let topicArray = []
  if (topic) {
    if (Array.isArray(topic)) {
      // Validate and normalize colors to hex format
      topicArray = topic.map(t => {
        const name = typeof t === 'string' ? t : (t?.name || '')
        let color = typeof t === 'object' && t?.color ? t.color : '#60BC26'
        
        // Ensure color is in hex format
        if (!color.startsWith('#')) {
          color = '#60BC26' // Default if not hex
        } else {
          // Validate hex format (6 or 8 characters after #)
          const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/
          if (!hexPattern.test(color)) {
            color = '#60BC26' // Default if invalid format
          }
        }
        
        return { name: name.trim(), color }
      }).filter(t => t.name) // Remove entries without names
    } else if (typeof topic === 'string') {
      // Backward compatibility: convert string to array format
      topicArray = [{ name: topic.trim(), color: '#60BC26' }]
    }
  }

  const channel = await Channel.create({
    name,
    description,
    topic: topicArray.length > 0 ? topicArray : undefined,
    isPrivate: !!isPrivate,
    members: from === 'connection' ? [members[0], members[1]] : [createdByUser._id],
    admins: from === 'connection' ? [admins[0], admins[1]] : [createdByUser._id],
    createdBy: createdByUser._id,
    tenantId: config.tenantId,
    isDefaultGeneral: !!isDefaultGeneral,
    chime: { channelArn, mode: 'RESTRICTED', privacy, type: from === 'connection' ? 'dm' : 'channel' }
  })
  logger.info('[Chime] Channel saved to MongoDB', { 
    channelId: channel._id,
    tenantId: config.tenantId,
    tenantName: config.tenantName,
  })
  
  await adminMessagingClient.send(new CreateChannelMembershipCommand({
    ChannelArn: channelArn,
    MemberArn: creatorArn,
    Type: 'DEFAULT',
    ChimeBearer: creatorArn
  }))
  logger.info('[Chime] Creator added as channel member', { channelArn, creatorArn })
  
  // Promote creator to channel moderator in Chime
  try {
    await adminMessagingClient.send(
      new CreateChannelModeratorCommand({
        ChannelArn: channelArn,
        ChannelModeratorArn: creatorArn,
        ChimeBearer: creatorArn,
      })
    );
    logger.info("[Chime] Creator promoted to channel moderator", {
      channelArn,
      creatorArn,
    });
  } catch (err) {
    logger.warn("[Chime] Failed to promote creator to moderator (continuing)", {
      error: err?.message,
      channelArn,
    });
  }
  return channel;
}

async function addMember({ channelId, user, operatorUser, userDetails = {} }) {
  // Default operator to the same user if not explicitly provided
  const actingUser = operatorUser || user;
  logger.info("[Chime] addMember start", {
    channelId,
    userId: user._id,
    operatorUserId: actingUser._id,
  });
  
  // ALWAYS fetch fresh tenant-specific Chime config from database
  const config = await getTenantChimeConfig(user);
  
  const channel = await Channel.findById(channelId);
  if (!channel || !channel?.chime?.channelArn) {
    logger.error("[Chime] Channel not found or not mapped to Chime", {
      channelId,
      hasChannel: !!channel,
      hasChannelArn: !!channel?.chime?.channelArn,
    });
    throw new Error("Channel not found or not mapped to Chime");
  }
  const memberArn = await ensureAppInstanceUser(user);
  const operatorArn = await ensureAppInstanceUser(actingUser);
  logger.info("[Chime] Adding member to Chime channel", {
    channelArn: channel.chime.channelArn,
    memberArn,
    operatorArn,
    tenantId: config.tenantId,
    tenantName: config.tenantName,
  });
  logger.info("[Chime] Using ChimeBearer for addMember", {
    chimeBearer: operatorArn,
  });

  try {
    await adminMessagingClient.send(
      new CreateChannelMembershipCommand({
        ChannelArn: channel.chime.channelArn,
        MemberArn: memberArn,
        Type: "DEFAULT",
        ChimeBearer: operatorArn,
      })
    );
    logger.info("[Chime] Member added to Chime channel successfully");
  } catch (error) {
    // Handle AWS Chime specific errors gracefully
    if (
      error.name === "ConflictException" ||
      error.message?.includes("already a member")
    ) {
      logger.info("[Chime] User already a member of Chime channel", {
        channelId,
        userId: user._id,
        error: error.message,
      });
    } else if (
      error.name === "ForbiddenException" ||
      error.message?.includes("not authorized")
    ) {
      logger.error(
        "[Chime] User not authorized to add members to this channel",
        { channelId, userId: user._id, error: error.message }
      );
      throw new Error("Not authorized to add members to this channel");
    } else if (error.name === "NotFoundException") {
      logger.error("[Chime] Channel or user not found in Chime", {
        channelId,
        userId: user._id,
        error: error.message,
      });
      throw new Error("Channel or user not found");
    } else {
      logger.error("[Chime] Unexpected error adding member to Chime channel", {
        channelId,
        userId: user._id,
        error: error.message,
        errorName: error.name,
      });
      throw new Error(`Failed to add member to channel: ${error.message}`);
    }
  }

  // Use atomic update to prevent race conditions and duplicates
  const updateResult = await Channel.updateOne(
    {
      _id: channelId,
      members: { $ne: user._id }, // Only update if user is not already a member
    },
    {
      $addToSet: { members: user._id }, // $addToSet prevents duplicates
    }
  );

  if (updateResult.modifiedCount > 0) {
    logger.info("[Chime] Member added to MongoDB channel", {
      channelId,
      userId: user._id,
    });

    // Ensure unread count tracking exists for the new member
    // Use fresh tenant config instead of potentially empty userDetails
    try {
      const UnreadCountService = (await import("./unreadCountService.js"))
        .default;
      await UnreadCountService.ensureUnreadTracking(
        channelId,
        user._id.toString(),
        config.tenantId,
        config.tenantUserLinkId
      );
      logger.info("[Chime] Unread count tracking ensured for new member", {
        channelId,
        userId: user._id,
        tenantId: config.tenantId,
      });
    } catch (unreadError) {
      // Log error but don't fail the membership addition
      logger.error("[Chime] Failed to ensure unread count tracking", {
        channelId,
        userId: user._id,
        error: unreadError.message,
      });
    }
  } else {
    logger.info("[Chime] Member already in MongoDB channel", {
      channelId,
      userId: user._id,
    });
  }
  return channel;
}

async function ensureChimeMembership({ channelId, user, userDetails = {} }) {
  logger.info("[Chime] ensureChimeMembership start", {
    channelId,
    userId: user._id,
  });
  
  // ALWAYS fetch fresh tenant-specific Chime config from database
  const config = await getTenantChimeConfig(user);
  
  const channel = await Channel.findById(channelId);
  if (!channel || !channel?.chime?.channelArn) {
    logger.error("[Chime] Channel not found or not mapped to Chime", {
      channelId,
      hasChannel: !!channel,
      hasChannelArn: !!channel?.chime?.channelArn,
    });
    throw new Error("Channel not found or not mapped to Chime");
  }
  const userArn = await ensureAppInstanceUser(user);
  logger.info("[Chime] Ensuring Chime membership", {
    channelArn: channel.chime.channelArn,
    userArn,
    tenantId: config.tenantId,
    tenantName: config.tenantName,
  });

  try {
    await adminMessagingClient.send(
      new CreateChannelMembershipCommand({
        ChannelArn: channel.chime.channelArn,
        MemberArn: userArn,
        Type: "DEFAULT",
        ChimeBearer: userArn,
      })
    );
    logger.info("[Chime] Chime membership ensured successfully");
  } catch (error) {
    // If user is already a member, Chime will return an error - that's okay
    if (
      error.name === "ConflictException" ||
      error.message?.includes("already a member")
    ) {
      logger.info("[Chime] User already a member of Chime channel", {
        channelId,
        userId: user._id,
      });
    } else {
      logger.error("[Chime] Error ensuring Chime membership", {
        error: error.message,
      });
      throw error;
    }
  }

  return channel;
}

async function sendMessage({ channelId, author, content, userDetails = {} }) {
  logger.info("[Chime] sendMessage start", {
    channelId,
    authorId: author._id,
  });
  
  // ALWAYS fetch fresh tenant-specific Chime config from database
  const config = await getTenantChimeConfig(author);
  
  const channel = await Channel.findById(channelId);
  if (!channel || !channel?.chime?.channelArn)
    throw new Error("Channel not found or not mapped to Chime");
  const authorArn = await ensureAppInstanceUser(author);

  // Ensure the user is a member of the Chime channel before sending a message
  logger.info(
    "[Chime] Ensuring user is member of channel before sending message",
    { 
      channelId, 
      userId: author._id,
      tenantId: config.tenantId,
      tenantName: config.tenantName,
    }
  );
  await addMember({ channelId, user: author });

  // Add a small delay to allow Chime membership to propagate
  await new Promise((resolve) => setTimeout(resolve, 1000));
  logger.info("[Chime] Membership propagation delay completed");

  const res = await adminMessagingClient.send(
    new SendChannelMessageCommand({
      ChannelArn: channel.chime.channelArn,
      Content: content,
      Type: "STANDARD",
      ChimeBearer: authorArn,
      Persistence: "PERSISTENT",
    })
  );
  
  // Use fresh tenant config instead of potentially empty userDetails
  const message = await Message.create({
    channelId: channel._id,
    authorId: author._id,
    content,
    isEdited: false,
    tenantUserLinkId: config.tenantUserLinkId,
    tenantId: config.tenantId,
    externalRef: {
      provider: "chime",
      messageId: res.MessageId,
      channelArn: channel.chime.channelArn,
    },
  });
  
  logger.info("[Chime] Message sent successfully", {
    messageId: res.MessageId,
    tenantId: config.tenantId,
  });
  
  return { message, chime: { messageId: res.MessageId } };
}

async function listMessages({ channelId, nextToken, pageSize = 50, user, userDetails = {} }) {
  logger.info("[Chime] listMessages start", { channelId, nextToken, pageSize });
  
  // ALWAYS fetch fresh tenant-specific Chime config from database
  const config = await getTenantChimeConfig(user);
  
  const channel = await Channel.findById(channelId);
  if (!channel || !channel?.chime?.channelArn) {
    logger.error("[Chime] Channel not found or not mapped to Chime", {
      channelId,
      hasChannel: !!channel,
      hasChannelArn: !!channel?.chime?.channelArn,
    });
    throw new Error("Channel not found or not mapped to Chime");
  }
  logger.info("[Chime] Channel found", {
    channelArn: channel.chime.channelArn,
    tenantId: config.tenantId,
    tenantName: config.tenantName,
  });

  // Get the user's AppInstanceUser ARN for ChimeBearer
  const appInstanceUserArn = await ensureAppInstanceUser(user);
  logger.info("[Chime] Using AppInstanceUser ARN as ChimeBearer", {
    appInstanceUserArn,
    tenantId: config.tenantId,
  });

  // Backend-side listing for now; alternatively the frontend can list directly using Cognito credentials
  try {
    const describe = await adminMessagingClient.send(
      new DescribeChannelCommand({
        ChannelArn: channel.chime.channelArn,
        ChimeBearer: appInstanceUserArn,
      })
    );
    logger.info("[Chime] Using ChimeBearer for describe/list messages", {
      chimeBearer: appInstanceUserArn,
    });
    logger.info("[Chime] Channel described successfully", {
      channelArn: channel.chime.channelArn,
    });
    void describe; // suppress unused in case not used in the future
  } catch (err) {
    logger.error("[Chime] Error describing channel", {
      error: err.message,
      channelArn: channel.chime.channelArn,
    });
    throw err;
  }

  try {
    const res = await adminMessagingClient.send(
      new ListChannelMessagesCommand({
        ChannelArn: channel.chime.channelArn,
        ChimeBearer: appInstanceUserArn,
        MaxResults: pageSize,
        NextToken: nextToken,
      })
    );
    logger.info("[Chime] Messages listed successfully", {
      messageCount: res.ChannelMessages?.length || 0,
      nextToken: res.NextToken,
    });

    const chimeMessages = res.ChannelMessages || [];

    // Build list of messageIds and fetch reactions in one query
    const messageIds = chimeMessages.map((m) => m.MessageId).filter(Boolean);

    // Prime local store for missing messages using bulkWrite (avoid N+1 awaits)
    try {
      if (messageIds.length > 0) {
        const existingDocs = await Message.find(
          {
            "externalRef.provider": "chime",
            "externalRef.messageId": { $in: messageIds },
          },
          { "externalRef.messageId": 1 }
        ).lean();
        const existingSet = new Set(
          (existingDocs || []).map((d) => d.externalRef?.messageId)
        );
        const ops = [];
        for (const m of chimeMessages) {
          if (!existingSet.has(m.MessageId)) {
            ops.push({
              insertOne: {
                document: {
                  channelId: channel._id,
                  authorId: user._id,
                  content: m.Content || "",
                  isEdited: !!m.LastEditedTimestamp,
                  metadata: m.Metadata || null,
                  externalRef: {
                    provider: "chime",
                    messageId: m.MessageId,
                    channelArn: channel.chime.channelArn,
                  },
                  ...(m.CreatedTimestamp
                    ? { createdAt: new Date(m.CreatedTimestamp) }
                    : {}),
                  ...(m.LastEditedTimestamp
                    ? { updatedAt: new Date(m.LastEditedTimestamp) }
                    : {}),
                },
              },
            });
          }
        }
        if (ops.length > 0) {
          await Message.bulkWrite(ops, { ordered: false });
        }
      }
    } catch {}

    // Load all reactions for these messages at once
    let reactionsDocs = [];
    try {
      reactionsDocs = await Message.find(
        {
          "externalRef.provider": "chime",
          "externalRef.messageId": { $in: messageIds },
        },
        { "externalRef.messageId": 1, reactions: 1 }
      ).lean();
    } catch {}
    const idToReactions = new Map();
    for (const d of reactionsDocs || []) {
      idToReactions.set(d.externalRef?.messageId, d.reactions || {});
    }

    const uid = String(user._id);
    const items = chimeMessages.map((m) => {
      const r = idToReactions.get(m.MessageId) || {};
      const counts = {
        like: (r.like || []).length,
        love: (r.love || []).length,
        laugh: (r.laugh || []).length,
        wow: (r.wow || []).length,
      };
      const mine = {
        like: Array.isArray(r.like) && r.like.some((id) => String(id) === uid),
        love: Array.isArray(r.love) && r.love.some((id) => String(id) === uid),
        laugh:
          Array.isArray(r.laugh) && r.laugh.some((id) => String(id) === uid),
        wow: Array.isArray(r.wow) && r.wow.some((id) => String(id) === uid),
      };
      return {
        messageId: m.MessageId,
        content: m.Content,
        createdTimestamp: m.CreatedTimestamp,
        lastEditedTimestamp: m.LastEditedTimestamp,
        sender: m.Sender,
        type: m.Type,
        metadata: m.Metadata,
        reactions: counts,
        myReactions: mine,
      };
    });

    return { items, nextToken: res.NextToken };
  } catch (err) {
    logger.error("[Chime] Error listing messages", {
      error: err.message,
      channelArn: channel.chime.channelArn,
    });
    throw err;
  }
}

export default {
  ensureAppInstanceUser,
  promoteToAppInstanceAdmin,
  createChannel,
  checkChannelExistsInChime,
  syncChannelFromChime,
  getChannelMembersFromChime,
  mapChimeUserArnToMongoUserId,
  addMember,
  ensureChimeMembership,
  sendMessage,
  listMessages,
  async deleteChannel({ channelId, operatorUser, userDetails = {} }) {
    logger.info("[Chime] deleteChannel start", {
      channelId,
      operatorUserId: operatorUser._id,
    });
    
    // ALWAYS fetch fresh tenant-specific Chime config from database
    const config = await getTenantChimeConfig(operatorUser);
    
    const channel = await Channel.findById(channelId);
    if (!channel || !channel?.chime?.channelArn)
      throw new Error("Channel not found or not mapped to Chime");
    const operatorArn = await ensureAppInstanceUser(operatorUser);
    
    logger.info("[Chime] Deleting channel", {
      channelArn: channel.chime.channelArn,
      tenantId: config.tenantId,
      tenantName: config.tenantName,
    });
    
    await adminMessagingClient.send(
      new DeleteChannelCommand({
        ChannelArn: channel.chime.channelArn,
        ChimeBearer: operatorArn,
      })
    );
    await Channel.deleteOne({ _id: channelId });
    await Message.deleteMany({ channelId });
    
    logger.info("[Chime] Channel deleted successfully", {
      channelId,
      tenantId: config.tenantId,
    });
    
    return { deleted: true };
  },
  async deleteChannelMessage({ channelId, messageId, operatorUser, userDetails = {} }) {
    logger.info("[Chime] deleteChannelMessage start", {
      channelId,
      messageId,
      operatorUserId: operatorUser._id,
    });
    
    // ALWAYS fetch fresh tenant-specific Chime config from database
    const config = await getTenantChimeConfig(operatorUser);
    
    const channel = await Channel.findById(channelId);
    if (!channel || !channel?.chime?.channelArn)
      throw new Error("Channel not found or not mapped to Chime");
    const operatorArn = await ensureAppInstanceUser(operatorUser);
    
    logger.info("[Chime] Deleting channel message", {
      channelArn: channel.chime.channelArn,
      messageId,
      tenantId: config.tenantId,
      tenantName: config.tenantName,
    });
    
    await adminMessagingClient.send(
      new DeleteChannelMessageCommand({
        ChannelArn: channel.chime.channelArn,
        MessageId: messageId,
        ChimeBearer: operatorArn,
      })
    );
    await Message.deleteOne({
      channelId,
      "externalRef.provider": "chime",
      "externalRef.messageId": messageId,
    });
    
    logger.info("[Chime] Message deleted successfully", {
      channelId,
      messageId,
      tenantId: config.tenantId,
    });
    
    return { deleted: true };
  },
  async grantChannelModerator({ channelId, user, operatorUser, userDetails = {} }) {
    const actingUser = operatorUser || user;
    logger.info("[Chime] grantChannelModerator start", {
      channelId,
      userId: user._id,
      operatorUserId: actingUser._id,
    });
    
    // ALWAYS fetch fresh tenant-specific Chime config from database
    const config = await getTenantChimeConfig(actingUser);
    
    const channel = await Channel.findById(channelId);
    if (!channel || !channel?.chime?.channelArn)
      throw new Error("Channel not found or not mapped to Chime");
    const memberArn = await ensureAppInstanceUser(user);
    const operatorArn = await ensureAppInstanceUser(actingUser);
    
    logger.info("[Chime] Granting channel moderator privileges", {
      channelArn: channel.chime.channelArn,
      memberArn,
      tenantId: config.tenantId,
      tenantName: config.tenantName,
    });
    
    await adminMessagingClient.send(
      new CreateChannelModeratorCommand({
        ChannelArn: channel.chime.channelArn,
        ChannelModeratorArn: memberArn,
        ChimeBearer: operatorArn,
      })
    );
    
    logger.info("[Chime] Channel moderator granted successfully", {
      channelId,
      userId: user._id,
      tenantId: config.tenantId,
    });
    
    return { success: true };
  },
  async revokeChannelModerator({ channelId, user, operatorUser, userDetails = {} }) {
    const actingUser = operatorUser || user;
    logger.info("[Chime] revokeChannelModerator start", {
      channelId,
      userId: user._id,
      operatorUserId: actingUser._id,
    });
    
    // ALWAYS fetch fresh tenant-specific Chime config from database
    const config = await getTenantChimeConfig(actingUser);
    
    const channel = await Channel.findById(channelId);
    if (!channel || !channel?.chime?.channelArn)
      throw new Error("Channel not found or not mapped to Chime");
    const memberArn = await ensureAppInstanceUser(user);
    const operatorArn = await ensureAppInstanceUser(actingUser);
    
    logger.info("[Chime] Revoking channel moderator privileges", {
      channelArn: channel.chime.channelArn,
      memberArn,
      tenantId: config.tenantId,
      tenantName: config.tenantName,
    });
    
    await adminMessagingClient.send(
      new DeleteChannelModeratorCommand({
        ChannelArn: channel.chime.channelArn,
        ChannelModeratorArn: memberArn,
        ChimeBearer: operatorArn,
      })
    );
    
    logger.info("[Chime] Channel moderator revoked successfully", {
      channelId,
      userId: user._id,
      tenantId: config.tenantId,
    });
    
    return { success: true };
  },
  async redactChannelMessage({ channelId, messageId, operatorUser, userDetails = {} }) {
    logger.info("[Chime] redactChannelMessage start", {
      channelId,
      messageId,
      operatorUserId: operatorUser._id,
    });
    
    // ALWAYS fetch fresh tenant-specific Chime config from database
    const config = await getTenantChimeConfig(operatorUser);
    
    const channel = await Channel.findById(channelId);
    if (!channel || !channel?.chime?.channelArn)
      throw new Error("Channel not found or not mapped to Chime");
    const operatorArn = await ensureAppInstanceUser(operatorUser);
    
    logger.info("[Chime] Redacting channel message", {
      channelId,
      messageId,
      operatorArn,
      tenantId: config.tenantId,
      tenantName: config.tenantName,
    });

    await adminMessagingClient.send(
      new RedactChannelMessageCommand({
        ChannelArn: channel.chime.channelArn,
        MessageId: messageId,
        ChimeBearer: operatorArn,
      })
    );

    // Update the message in MongoDB to mark as redacted
    // Set content to empty and add isRedacted flag to match Chime's behavior
    await Message.updateOne(
      {
        channelId,
        "externalRef.provider": "chime",
        "externalRef.messageId": messageId,
      },
      {
        $set: {
          content: "", // Empty content to match Chime redaction behavior
          isEdited: true,
          isRedacted: true,
          redactedAt: new Date(), // Track when message was redacted
        },
      }
    );

    logger.info("[Chime] Message redacted successfully", {
      channelId,
      messageId,
      tenantId: config.tenantId,
    });
    
    return { redacted: true };
  },
};
