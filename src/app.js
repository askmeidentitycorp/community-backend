import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import fileMiddleware from 'express-multipart-file-parser';
import { errorHandler } from './utils/errorHandler.js';
import { logger } from './utils/logger.js';
import connectDB from './config/database.js';
import { connectRedis } from './config/redis.js';
import routes from './routes/index.js';
import auth0Config from './config/auth0.js';

// Load environment variables only when not running as Firebase Function
if (!process.env.FUNCTIONS_EMULATOR && !process.env.GCLOUD_PROJECT) {
  dotenv.config();
}

// Log key (non-sensitive) config values at startup
logger.info('Config: backend startup', {
  port: process.env.PORT || 3000,
  baseUrls: {
    backend: process.env.BACKEND_BASE_URL || 'missing',
    frontend: process.env.FRONTEND_BASE_URL || 'missing'
  },
  auth0: {
    domain: auth0Config.domain || 'missing',
    audience: auth0Config.audience || 'missing',
    issuer: auth0Config.issuer || `https://${auth0Config.domain || 'missing'}/`,
    clientId: auth0Config.clientId ? 'set' : 'missing'
  }
});

// Create Express app
const app = express();

// Connect to MongoDB
connectDB().catch(err => {
  logger.error('Failed to connect to MongoDB:', err);
});

// Connect to Redis
// connectRedis();

// Middleware


// CORS configuration
const corsOptions = {
  origin: ['http://localhost:5173', 'https://connect.askmeidentitty.com'],
  methods: ['GET', 'POST', 'OPTIONS', 'DELETE', 'PUT', 'PATCH'],
  allowedHeaders: ['Authorization', 'Content-Type'],
  credentials: true,
};
app.use(cors(corsOptions));

// Explicit preflight handling (return 200 with headers)
// app.options('*', (req, res) => {
//   res.header('Access-Control-Allow-Origin', 'http://localhost:5173');
//   res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT, PATCH');
//   res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
//   res.header('Access-Control-Allow-Credentials', 'true');
//   return res.sendStatus(200);
// });

app.use(helmet());

// Use express-multipart-file-parser for multipart requests (Firebase Functions compatible)
app.use(fileMiddleware);

// Standard body parsing for non-multipart requests
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Routes
app.use('/api/v1', routes);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date() });
});

// Error handling
app.use(errorHandler);

// Start server only when not running as Firebase Function
const PORT = process.env.PORT || 8080;

// Only start the server if not running as a Firebase Function
if (!process.env.FUNCTIONS_EMULATOR && !process.env.GCLOUD_PROJECT) {
  app.listen(PORT, () => {
    logger.info(`Server running on port ${PORT}`);
  });
}

// Handle unhandled rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Rejection:', err);
  // In production, consider graceful shutdown
  // process.exit(1);
});

export default app;
