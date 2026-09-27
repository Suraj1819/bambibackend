import { Server } from 'socket.io';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/* ============================================================
   IN-MEMORY ROOM STORE
   room: {
     roomCode, createdAt, expiresAt,
     hostToken,        // secret only the creator's browser knows
     hostSocketId,     // current socket id acting as host (may change on rejoin)
     locked,           // host can block new joins
     users: [{ socketId, deviceName, deviceInfo, joinedAt, isHost }]
   }
============================================================ */
const rooms = new Map();

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 5; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Schedule room deletion after a grace period.
 * If someone (usually the host) rejoins within that time, the timer is cancelled.
 */
function scheduleRoomDeletion(code, io, delayMs = 5 * 60 * 1000) {
  const room = rooms.get(code);
  if (!room) return;

  if (room._deleteTimer) clearTimeout(room._deleteTimer);

  room._deleteTimer = setTimeout(() => {
    const currentRoom = rooms.get(code);
    if (currentRoom && currentRoom.users.length === 0) {
      rooms.delete(code);
      logger.info(`Room ${code} removed (empty after grace period)`);
    }
  }, delayMs);
}

function cancelRoomDeletion(code) {
  const room = rooms.get(code);
  if (room?._deleteTimer) {
    clearTimeout(room._deleteTimer);
    delete room._deleteTimer;
  }
}

function publicRoom(room) {
  // Never leak hostToken to clients
  const { hostToken, _deleteTimer, ...safe } = room;
  return safe;
}

/* ============================================================
   INIT SOCKET SERVER
============================================================ */
export function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  io.on('connection', (socket) => {
    logger.info(`Socket connected: ${socket.id}`);

    /* ============================================================
       CREATE ROOM
    ============================================================ */
    socket.on('create-room', ({ deviceName, deviceInfo } = {}, callback) => {
      try {
        let code;
        do {
          code = generateRoomCode();
        } while (rooms.has(code));

        const hostToken = generateToken();
        const now = Date.now();
        const room = {
          roomCode: code,
          createdAt: now,
          expiresAt: now + env.ROOM_EXPIRY_MINUTES * 60 * 1000,
          hostToken,
          hostSocketId: socket.id,
          locked: false,
          users: [
            {
              socketId: socket.id,
              deviceName: deviceName || 'Unknown Device',
              deviceInfo: deviceInfo || null,
              joinedAt: now,
              isHost: true,
            },
          ],
        };
        rooms.set(code, room);
        socket.join(code);

        logger.info(`Room created: ${code} by ${socket.id}`);

        const payload = {
          success: true,
          roomCode: code,
          hostToken, // only ever sent to the creator
          room: publicRoom(room),
        };
        if (typeof callback === 'function') callback(payload);
        socket.emit('room-created', payload);
      } catch (err) {
        logger.error(`create-room error: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, message: 'Failed to create room' });
        }
      }
    });

    /* ============================================================
       JOIN ROOM
    ============================================================ */
    socket.on('join-room', ({ roomCode, deviceName, deviceInfo, hostToken } = {}, callback) => {
      try {
        const code = (roomCode || '').toUpperCase().trim();
        const room = rooms.get(code);

        const fail = (message) => {
          if (typeof callback === 'function') callback({ success: false, message });
        };

        if (!room) return fail('This room does not exist or has expired.');
        if (Date.now() > room.expiresAt) {
          rooms.delete(code);
          return fail('Room has expired.');
        }

        cancelRoomDeletion(code);

        // Remove stale (disconnected) users first
        const staleUsers = room.users.filter((u) => {
          const s = io.sockets.sockets.get(u.socketId);
          return !s || !s.connected;
        });
        if (staleUsers.length > 0) {
          room.users = room.users.filter(
            (u) => !staleUsers.some((su) => su.socketId === u.socketId)
          );
        }

        // Already a member (e.g. duplicate join event) — just resync
        const alreadyMember = room.users.find((u) => u.socketId === socket.id);
        if (alreadyMember) {
          socket.join(code);
          if (typeof callback === 'function') callback({ success: true, room: publicRoom(room) });
          return;
        }

        // Reconnecting host: valid hostToken restores host identity
        const isReturningHost = Boolean(hostToken) && hostToken === room.hostToken;

        if (!isReturningHost) {
          if (room.locked) return fail('The host has locked this room.');
          if (room.users.length >= env.MAX_DEVICES_PER_ROOM) {
            return fail('Room is full.');
          }
        }

        const user = {
          socketId: socket.id,
          deviceName: deviceName || 'Unknown Device',
          deviceInfo: deviceInfo || null,
          joinedAt: Date.now(),
          isHost: isReturningHost,
        };

        if (isReturningHost) {
          room.hostSocketId = socket.id;
          room.users = room.users.filter((u) => !u.isHost);
          room.users.unshift(user);
        } else {
          room.users.push(user);
        }

        socket.join(code);

        logger.info(`Socket ${socket.id} joined room ${code} (users: ${room.users.length})`);

        if (typeof callback === 'function') {
          callback({ success: true, room: publicRoom(room) });
        }

        socket.to(code).emit('user-joined', {
          socketId: socket.id,
          deviceName: user.deviceName,
          isHost: user.isHost,
          room: publicRoom(room),
        });
      } catch (err) {
        logger.error(`join-room error: ${err.message}`);
        if (typeof callback === 'function') {
          callback({ success: false, message: 'Failed to join room' });
        }
      }
    });

    /* ============================================================
       LEAVE ROOM (soft leave — room stays alive, rejoin is allowed)
    ============================================================ */
    socket.on('leave-room', ({ roomCode } = {}) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) return;

      room.users = room.users.filter((u) => u.socketId !== socket.id);
      socket.leave(code);
      socket.to(code).emit('user-left', {
        socketId: socket.id,
        room: publicRoom(room),
      });

      if (room.users.length === 0) scheduleRoomDeletion(code, io);
    });

    /* ============================================================
       END ROOM (host only — destroys the room for everyone)
    ============================================================ */
    socket.on('end-room', ({ roomCode, hostToken } = {}, callback) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      const fail = (message) => typeof callback === 'function' && callback({ success: false, message });

      if (!room) return fail('Room not found.');
      if (hostToken !== room.hostToken) return fail('Only the host can end this room.');

      if (room._deleteTimer) clearTimeout(room._deleteTimer);
      io.to(code).emit('room-ended', { roomCode: code });
      io.socketsLeave(code);
      rooms.delete(code);
      logger.info(`Room ${code} ended by host`);
      if (typeof callback === 'function') callback({ success: true });
    });

    /* ============================================================
       LOCK / UNLOCK ROOM (host only)
    ============================================================ */
    socket.on('set-room-lock', ({ roomCode, hostToken, locked } = {}, callback) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      const fail = (message) => typeof callback === 'function' && callback({ success: false, message });

      if (!room) return fail('Room not found.');
      if (hostToken !== room.hostToken) return fail('Only the host can change the lock.');

      room.locked = Boolean(locked);
      io.to(code).emit('room-lock-changed', { locked: room.locked });
      if (typeof callback === 'function') callback({ success: true, locked: room.locked });
    });

    /* ============================================================
       KICK PEER (host only)
    ============================================================ */
    socket.on('kick-peer', ({ roomCode, hostToken, socketId } = {}, callback) => {
      const code = (roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      const fail = (message) => typeof callback === 'function' && callback({ success: false, message });

      if (!room) return fail('Room not found.');
      if (hostToken !== room.hostToken) return fail('Only the host can remove a peer.');

      room.users = room.users.filter((u) => u.socketId !== socketId);
      io.to(socketId).emit('kicked');
      io.sockets.sockets.get(socketId)?.leave(code);
      // Use io.to so the host (kicker) also receives user-left and clears the peer chip
      io.to(code).emit('user-left', { socketId, room: publicRoom(room) });
      if (typeof callback === 'function') callback({ success: true });
    });

    /* ============================================================
       WEBRTC SIGNALING
    ============================================================ */
    socket.on('webrtc-offer', ({ roomCode, offer } = {}) => {
      socket.to(roomCode).emit('webrtc-offer', { fromSocketId: socket.id, offer });
    });

    socket.on('webrtc-answer', ({ roomCode, answer } = {}) => {
      socket.to(roomCode).emit('webrtc-answer', { fromSocketId: socket.id, answer });
    });

    socket.on('webrtc-ice-candidate', ({ roomCode, candidate } = {}) => {
      socket.to(roomCode).emit('webrtc-ice-candidate', { fromSocketId: socket.id, candidate });
    });

    /* ============================================================
       DISCONNECT (accidental — room persists for reconnection)
    ============================================================ */
    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${socket.id}`);

      for (const [code, room] of rooms.entries()) {
        const before = room.users.length;
        room.users = room.users.filter((u) => u.socketId !== socket.id);

        if (room.users.length !== before) {
          io.to(code).emit('user-left', { socketId: socket.id, room: publicRoom(room) });
        }

        if (room.users.length === 0) scheduleRoomDeletion(code, io);
      }
    });
  });

  /* ============================================================
     Expired rooms cleanup
  ============================================================ */
  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms.entries()) {
      if (now > room.expiresAt) {
        io.to(code).emit('room-expired');
        if (room._deleteTimer) clearTimeout(room._deleteTimer);
        rooms.delete(code);
        logger.info(`Room ${code} expired and removed`);
      }
    }
  }, 60 * 1000);

  return io;
}