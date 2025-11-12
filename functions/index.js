import { onRequest } from 'firebase-functions/v2/https';
import app from './src/app.js';

// Export your Express app as a Firebase Function
export const api = onRequest({
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 540,
  maxInstances: 12
}, app);