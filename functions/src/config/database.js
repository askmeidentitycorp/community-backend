import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

const connectDB = async () => {
  try {
    const tenantId = process.env.TENANT_ID || 'tenant1';
    // const databaseName = process.env.MONGODB_DATABASE || `${tenantId}_discussion`;
    const databaseName = process.env.MONGODB_DATABASE;
    const mongoURI = process.env.MONGODB_URI || '';
    
    // Log connection attempt without exposing credentials
    const safeURI = mongoURI.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
    logger.info('Connecting to MongoDB', { database: databaseName, uri: safeURI });

    // Prefer passing dbName as an option so URIs with their own path/query remain valid
    await mongoose.connect(mongoURI, { 
      dbName: databaseName,
      serverSelectionTimeoutMS: 10000, // 10 second timeout
      socketTimeoutMS: 45000,
    });

    logger.info(`MongoDB connected successfully`, {
      dbName: databaseName,
      uriHost: mongoURI.replace(/:\/\/[\w.-]+:(?:[^@]+)@/, '://****:****@'),
    });
  } catch (error) {
    logger.error('MongoDB connection error:', error);
    // DO NOT call process.exit() in Cloud Run/Firebase Functions
    // This would prevent the container from starting and cause health check failures
    // Instead, let the app continue and handle DB errors in route handlers
    throw error;
  }
};

export default connectDB;