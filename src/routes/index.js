import express from 'express';
import authRoutes from './auth.js';
import userRoutes from './users.js';
import discussionRoutes from './discussions.js';
import commentRoutes from './comments.js';
import channelRoutes from './channels.js';

const router = express.Router();

// API routes
router.use('/auth', authRoutes);
router.use('/', userRoutes); // User management routes
router.use('/', discussionRoutes); // Discussion routes
router.use('/', commentRoutes); // Comment routes
router.use('/', channelRoutes); // Channel + messages routes

export default router;
