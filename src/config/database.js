import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

const connectDB = async () => {
  try {
    const tenantId = process.env.TENANT_ID || 'tenant1';
    // const databaseName = process.env.MONGODB_DATABASE || `${tenantId}_discussion`;
    const databaseName = 'tenant_community_db_ami';
    const mongoURI = process.env.MONGODB_URI || '';
    console.log('Connecting to MongoDB with URI:', mongoURI, 'and database:', databaseName);

    // Prefer passing dbName as an option so URIs with their own path/query remain valid
    await mongoose.connect(mongoURI, { dbName: databaseName });

    logger.info(`MongoDB connected successfully`, {
      dbName: databaseName,
      uriHost: mongoURI.replace(/:\/\/[\w.-]+:(?:[^@]+)@/, '://****:****@'),
    });
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    process.exit(1);
  }
};

export default connectDB;