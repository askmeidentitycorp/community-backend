import mongoose from 'mongoose';

const tagSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  color: {
    type: String,
    required: true,
    trim: true,
    match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/, // Hex color format
  },
}, {
  _id: false, // Don't create _id for subdocuments
});

const logoSchema = new mongoose.Schema({
  url: {
    type: String,
    trim: true,
    default: null,
  },
  uploadedAt: {
    type: Date,
    default: null,
  },
}, {
  _id: false,
});

const tenantConfigSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    tags: {
      type: [tagSchema],
      default: [],
      validate: {
        validator: function(tags) {
          // Ensure tag IDs are unique within the array
          const ids = tags.map(t => t.id);
          return ids.length === new Set(ids).size;
        },
        message: 'Tag IDs must be unique within a tenant',
      },
    },
    logo: {
      type: logoSchema,
      default: () => ({}),
    },
    updatedBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
tenantConfigSchema.index({ tenantId: 1 });

// Static method to find or create config for a tenant
tenantConfigSchema.statics.findOrCreate = async function(tenantId) {
  let config = await this.findOne({ tenantId });
  if (!config) {
    config = await this.create({
      tenantId,
      tags: [],
      logo: {},
    });
  }
  return config;
};

// Instance method to validate tag structure
tenantConfigSchema.methods.validateTags = function() {
  if (!Array.isArray(this.tags)) {
    return { valid: false, error: 'Tags must be an array' };
  }
  
  if (this.tags.length > 50) {
    return { valid: false, error: 'Maximum 50 tags allowed per tenant' };
  }

  const ids = new Set();
  for (const tag of this.tags) {
    if (!tag.id || !tag.name || !tag.color) {
      return { valid: false, error: 'Each tag must have id, name, and color' };
    }
    
    if (ids.has(tag.id)) {
      return { valid: false, error: `Duplicate tag ID: ${tag.id}` };
    }
    ids.add(tag.id);
    
    // Validate color format
    if (!/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{8})$/.test(tag.color)) {
      return { valid: false, error: `Invalid color format for tag ${tag.id}: ${tag.color}` };
    }
  }
  
  return { valid: true };
};

export const TenantConfig = mongoose.model('TenantConfig', tenantConfigSchema);

