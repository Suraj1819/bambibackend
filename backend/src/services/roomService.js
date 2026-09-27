import { env } from '../config/env.js';
import { generateRoomCode } from '../utils/generateRoomCode.js';
import { logger } from '../utils/logger.js';

// In-memory room store. No database required for the MVP.
// rooms: Map<roomCode, { roomCode, createdAt, expiresAt, users: [{socketId, deviceName, joinedAt}] }>
const rooms = new Map();

const EXPIRY_MS = env.ROOM_EXPIRY_MINUTES * 60 * 1000;
const MAX_DEVICES = env.MAX_DEVICES_PER_ROOM;

export function createRoom() {
  const existingCodes = new Set(rooms.keys());
  const roomCode = generateRoomCode(existingCodes);
  const now = Date.now();

  const room = {
    roomCode,
    createdAt: now,
    expiresAt: now + EXPIRY_MS,
    users: [],
  };

  rooms.set(roomCode, room);
  logger.info(`Room created: ${roomCode}`);
  return room;
}

export function getRoom(roomCode) {
  if (!roomCode) return null;
  return rooms.get(roomCode.toUpperCase()) || null;
}

export function isRoomExpired(room) {
  if (!room) return true;
  return Date.now() > room.expiresAt;
}

export function roomExists(roomCode) {
  const room = getRoom(roomCode);
  return Boolean(room) && !isRoomExpired(room);
}

export function isRoomFull(room) {
  return room.users.length >= MAX_DEVICES;
}

export function joinRoom(roomCode, socketId, deviceName) {
  const room = getRoom(roomCode);

  if (!room) {
    return { success: false, error: 'ROOM_NOT_FOUND', message: 'Room not found.' };
  }

  if (isRoomExpired(room)) {
    rooms.delete(room.roomCode);
    return { success: false, error: 'ROOM_EXPIRED', message: 'Room has expired.' };
  }

  if (isRoomFull(room)) {
    return { success: false, error: 'ROOM_FULL', message: 'Room is full.' };
  }

  const user = {
    socketId,
    deviceName: deviceName || 'Unknown Device',
    joinedAt: Date.now(),
  };

  room.users.push(user);
  logger.info(`Socket ${socketId} joined room ${room.roomCode}`);
  return { success: true, room, user };
}

export function addHostToRoom(roomCode, socketId, deviceName) {
  const room = getRoom(roomCode);
  if (!room) return null;

  room.users.push({
    socketId,
    deviceName: deviceName || 'Unknown Device',
    joinedAt: Date.now(),
  });

  return room;
}

export function leaveRoom(socketId) {
  for (const room of rooms.values()) {
    const idx = room.users.findIndex((u) => u.socketId === socketId);
    if (idx !== -1) {
      const [removedUser] = room.users.splice(idx, 1);
      logger.info(`Socket ${socketId} left room ${room.roomCode}`);

      // Clean up empty rooms immediately
      if (room.users.length === 0) {
        rooms.delete(room.roomCode);
        logger.info(`Room ${room.roomCode} removed (empty)`);
      }

      return { room, removedUser };
    }
  }
  return null;
}

export function removeRoom(roomCode) {
  return rooms.delete(roomCode);
}

export function cleanupExpiredRooms() {
  const now = Date.now();
  let removed = 0;

  for (const [code, room] of rooms.entries()) {
    if (now > room.expiresAt) {
      rooms.delete(code);
      removed++;
    }
  }

  if (removed > 0) {
    logger.info(`Cleaned up ${removed} expired room(s)`);
  }

  return removed;
}

export function getRoomCount() {
  return rooms.size;
}

export function getOtherUsersInRoom(roomCode, excludeSocketId) {
  const room = getRoom(roomCode);
  if (!room) return [];
  return room.users.filter((u) => u.socketId !== excludeSocketId);
}
