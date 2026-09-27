import { logger } from './logger.js';

/**
 * Placeholder for cleanup job.
 * Actual cleanup is handled inside `socketServer.js`.
 * Kept so `server.js` doesn't break when importing `startRoomCleanupJob`.
 */
export function startRoomCleanupJob() {
  logger.info('Room cleanup job registered (handled inside socketServer)');
}

// Also export alias in case your code imports the other name
export const startRoomCleanup = startRoomCleanupJob;