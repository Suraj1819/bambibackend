import http from 'http';

import app from './app.js';

import { env } from './config/env.js';

import {
  initSocketServer,
} from './socket/socketServer.js';

import {
  startRoomCleanupJob,
} from './utils/roomCleanup.js';

import {
  logger,
} from './utils/logger.js';


const server =
  http.createServer(app);


/*
 * Socket.IO is used only for:
 *
 * - room management
 * - WebRTC signaling
 * - peer connection setup
 *
 * Actual files are transferred
 * directly between devices using
 * WebRTC DataChannel.
 */
initSocketServer(server);


/*
 * Remove expired rooms
 * automatically.
 */
startRoomCleanupJob();


server.listen(
  env.PORT,
  () => {
    logger.info(
      `WebDrop server running on port ${env.PORT} [${env.NODE_ENV}]`
    );

    logger.info(
      `Allowed client origin: ${env.CLIENT_URL}`
    );
  }
);