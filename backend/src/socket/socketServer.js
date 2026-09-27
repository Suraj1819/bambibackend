import { Server } from 'socket.io';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/* ============================================================
   IN-MEMORY ROOM STORE

   room: {
     roomCode,
     createdAt,
     expiresAt,
     hostToken,
     hostSocketId,
     locked,
     users: [
       {
         socketId,
         deviceName,
         deviceInfo,
         joinedAt,
         isHost
       }
     ]
   }
============================================================ */

const rooms = new Map();

/* ============================================================
   ROOM CODE
============================================================ */

const CHARS =
  'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  let code = '';

  for (let i = 0; i < 5; i++) {
    code +=
      CHARS[
        Math.floor(
          Math.random() * CHARS.length
        )
      ];
  }

  return code;
}

/* ============================================================
   HOST TOKEN
============================================================ */

function generateToken() {
  return crypto
    .randomBytes(16)
    .toString('hex');
}

/* ============================================================
   ROOM DELETION
============================================================ */

function scheduleRoomDeletion(
  code,
  io,
  delayMs = 5 * 60 * 1000
) {
  const room = rooms.get(code);

  if (!room) {
    return;
  }

  if (room._deleteTimer) {
    clearTimeout(room._deleteTimer);
  }

  room._deleteTimer = setTimeout(() => {
    const currentRoom = rooms.get(code);

    if (
      currentRoom &&
      currentRoom.users.length === 0
    ) {
      rooms.delete(code);

      logger.info(
        `Room ${code} removed (empty after grace period)`
      );
    }
  }, delayMs);
}

/* ============================================================
   CANCEL ROOM DELETION
============================================================ */

function cancelRoomDeletion(code) {
  const room = rooms.get(code);

  if (room?._deleteTimer) {
    clearTimeout(room._deleteTimer);
    delete room._deleteTimer;
  }
}

/* ============================================================
   PUBLIC ROOM
   Never expose hostToken
============================================================ */

function publicRoom(room) {
  const {
    hostToken,
    _deleteTimer,
    ...safe
  } = room;

  return safe;
}

/* ============================================================
   SOCKET SERVER
============================================================ */

export function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.CLIENT_URL,
      methods: ['GET', 'POST'],
      credentials: true,
    },

    transports: ['polling', 'websocket'],

    /* ----------------------------------------------------------
       FIX: Faster disconnect detection.

       Socket.io's defaults (pingInterval: 25000, pingTimeout: 20000)
       mean the SERVER can take up to ~45 seconds to realise a
       socket has actually gone away (mobile network drop, tab
       backgrounded, screen locked, hotspot hiccup, etc).

       During that window, the guest's stale slot is still counted
       against MAX_DEVICES_PER_ROOM, so if they try to rejoin
       quickly they can incorrectly get "Room is full" even though
       the old connection is dead. Shortening these values makes
       the server detect the drop in a few seconds instead, so a
       quick rejoin (which is exactly the mobile hotspot scenario
       here) works reliably.
    ---------------------------------------------------------- */
    pingInterval: 5000,
    pingTimeout: 8000,
  });

  /* ==========================================================
     CONNECTION
  ========================================================== */

  io.on('connection', (socket) => {
    logger.info(
      `Socket connected: ${socket.id}`
    );

    /* ========================================================
       CREATE ROOM
    ======================================================== */

    socket.on(
      'create-room',
      (
        {
          deviceName,
          deviceInfo,
        } = {},
        callback
      ) => {
        try {
          let code;

          do {
            code = generateRoomCode();
          } while (rooms.has(code));

          const hostToken =
            generateToken();

          const now = Date.now();

          const room = {
            roomCode: code,

            createdAt: now,

            expiresAt:
              now +
              env.ROOM_EXPIRY_MINUTES *
                60 *
                1000,

            hostToken,

            hostSocketId: socket.id,

            locked: false,

            users: [
              {
                socketId: socket.id,

                deviceName:
                  deviceName ||
                  'Unknown Device',

                deviceInfo:
                  deviceInfo || null,

                joinedAt: now,

                isHost: true,
              },
            ],
          };

          rooms.set(
            code,
            room
          );

          socket.join(code);

          logger.info(
            `Room created: ${code} by ${socket.id}`
          );

          const payload = {
            success: true,

            roomCode: code,

            hostToken,

            room: publicRoom(room),
          };

          if (
            typeof callback === 'function'
          ) {
            callback(payload);
          }

          socket.emit(
            'room-created',
            payload
          );
        } catch (err) {
          logger.error(
            `create-room error: ${err.message}`
          );

          if (
            typeof callback === 'function'
          ) {
            callback({
              success: false,
              message:
                'Failed to create room',
            });
          }
        }
      }
    );

    /* ========================================================
       JOIN ROOM
    ======================================================== */

    socket.on(
      'join-room',
      (
        {
          roomCode,
          deviceName,
          deviceInfo,
          hostToken,
        } = {},
        callback
      ) => {
        try {
          const code =
            (roomCode || '')
              .toUpperCase()
              .trim();

          const room =
            rooms.get(code);

          const fail = (message) => {
            if (
              typeof callback ===
              'function'
            ) {
              callback({
                success: false,
                message,
              });
            }
          };

          if (!room) {
            return fail(
              'This room does not exist or has expired.'
            );
          }

          if (
            Date.now() >
            room.expiresAt
          ) {
            rooms.delete(code);

            return fail(
              'Room has expired.'
            );
          }

          cancelRoomDeletion(code);

          /* Remove stale users */

          const staleUsers =
            room.users.filter((user) => {
              const s =
                io.sockets.sockets.get(
                  user.socketId
                );

              return (
                !s ||
                !s.connected
              );
            });

          if (
            staleUsers.length > 0
          ) {
            room.users =
              room.users.filter(
                (user) =>
                  !staleUsers.some(
                    (stale) =>
                      stale.socketId ===
                      user.socketId
                  )
              );

            logger.info(
              `Room ${code}: cleared ${staleUsers.length} stale user(s) before join check`
            );
          }

          /* Already member */

          const alreadyMember =
            room.users.find(
              (user) =>
                user.socketId ===
                socket.id
            );

          if (alreadyMember) {
            socket.join(code);

            if (
              typeof callback ===
              'function'
            ) {
              callback({
                success: true,
                room: publicRoom(room),
              });
            }

            return;
          }

          /* Returning host */

          const isReturningHost =
            Boolean(hostToken) &&
            hostToken ===
              room.hostToken;

          if (!isReturningHost) {
            if (room.locked) {
              return fail(
                'The host has locked this room.'
              );
            }

            if (
              room.users.length >=
              env.MAX_DEVICES_PER_ROOM
            ) {
              return fail(
                'Room is full.'
              );
            }
          }

          const user = {
            socketId: socket.id,

            deviceName:
              deviceName ||
              'Unknown Device',

            deviceInfo:
              deviceInfo || null,

            joinedAt: Date.now(),

            isHost:
              isReturningHost,
          };

          if (isReturningHost) {
            room.hostSocketId =
              socket.id;

            room.users =
              room.users.filter(
                (user) =>
                  !user.isHost
              );

            room.users.unshift(
              user
            );
          } else {
            room.users.push(
              user
            );
          }

          socket.join(code);

          logger.info(
            `Socket ${socket.id} joined room ${code} (users: ${room.users.length})`
          );

          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: true,
              room: publicRoom(room),
            });
          }

          socket
            .to(code)
            .emit(
              'user-joined',
              {
                socketId:
                  socket.id,

                deviceName:
                  user.deviceName,

                isHost:
                  user.isHost,

                room:
                  publicRoom(room),
              }
            );
        } catch (err) {
          logger.error(
            `join-room error: ${err.message}`
          );

          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: false,
              message:
                'Failed to join room',
            });
          }
        }
      }
    );

    /* ========================================================
       LEAVE ROOM
    ======================================================== */

    socket.on(
      'leave-room',
      ({ roomCode } = {}) => {
        const code =
          (roomCode || '')
            .toUpperCase()
            .trim();

        const room =
          rooms.get(code);

        if (!room) {
          return;
        }

        room.users =
          room.users.filter(
            (user) =>
              user.socketId !==
              socket.id
          );

        socket.leave(code);

        socket
          .to(code)
          .emit(
            'user-left',
            {
              socketId:
                socket.id,

              room:
                publicRoom(room),
            }
          );

        if (
          room.users.length === 0
        ) {
          scheduleRoomDeletion(
            code,
            io
          );
        }
      }
    );

    /* ========================================================
       END ROOM
    ======================================================== */

    socket.on(
      'end-room',
      (
        {
          roomCode,
          hostToken,
        } = {},
        callback
      ) => {
        const code =
          (roomCode || '')
            .toUpperCase()
            .trim();

        const room =
          rooms.get(code);

        const fail = (message) => {
          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: false,
              message,
            });
          }
        };

        if (!room) {
          return fail(
            'Room not found.'
          );
        }

        if (
          hostToken !==
          room.hostToken
        ) {
          return fail(
            'Only the host can end this room.'
          );
        }

        if (room._deleteTimer) {
          clearTimeout(
            room._deleteTimer
          );
        }

        io.to(code).emit(
          'room-ended',
          {
            roomCode: code,
          }
        );

        io.socketsLeave(code);

        rooms.delete(code);

        logger.info(
          `Room ${code} ended by host`
        );

        if (
          typeof callback ===
          'function'
        ) {
          callback({
            success: true,
          });
        }
      }
    );

    /* ========================================================
       LOCK / UNLOCK ROOM
    ======================================================== */

    socket.on(
      'set-room-lock',
      (
        {
          roomCode,
          hostToken,
          locked,
        } = {},
        callback
      ) => {
        const code =
          (roomCode || '')
            .toUpperCase()
            .trim();

        const room =
          rooms.get(code);

        const fail = (message) => {
          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: false,
              message,
            });
          }
        };

        if (!room) {
          return fail(
            'Room not found.'
          );
        }

        if (
          hostToken !==
          room.hostToken
        ) {
          return fail(
            'Only the host can change the lock.'
          );
        }

        room.locked =
          Boolean(locked);

        io.to(code).emit(
          'room-lock-changed',
          {
            locked:
              room.locked,
          }
        );

        if (
          typeof callback ===
          'function'
        ) {
          callback({
            success: true,
            locked:
              room.locked,
          });
        }
      }
    );

    /* ========================================================
       KICK PEER
    ======================================================== */

    socket.on(
      'kick-peer',
      (
        {
          roomCode,
          hostToken,
          socketId,
        } = {},
        callback
      ) => {
        const code =
          (roomCode || '')
            .toUpperCase()
            .trim();

        const room =
          rooms.get(code);

        const fail = (message) => {
          if (
            typeof callback ===
            'function'
          ) {
            callback({
              success: false,
              message,
            });
          }
        };

        if (!room) {
          return fail(
            'Room not found.'
          );
        }

        if (
          hostToken !==
          room.hostToken
        ) {
          return fail(
            'Only the host can remove a peer.'
          );
        }

        room.users =
          room.users.filter(
            (user) =>
              user.socketId !==
              socketId
          );

        io.to(socketId).emit(
          'kicked'
        );

        io.sockets.sockets
          .get(socketId)
          ?.leave(code);

        io.to(code).emit(
          'user-left',
          {
            socketId,
            room:
              publicRoom(room),
          }
        );

        if (
          typeof callback ===
          'function'
        ) {
          callback({
            success: true,
          });
        }
      }
    );

    /* ========================================================
       WEBRTC SIGNALING
    ======================================================== */

    socket.on(
      'webrtc-offer',
      ({
        roomCode,
        offer,
      } = {}) => {
        try {
          const code =
            (roomCode || '')
              .toUpperCase()
              .trim();

          if (!code || !offer) {
            logger.warn(
              `Invalid WebRTC offer from ${socket.id}`
            );

            return;
          }

          const room =
            rooms.get(code);

          if (!room) {
            logger.warn(
              `WebRTC offer for unknown room ${code}`
            );

            return;
          }

          const isMember =
            room.users.some(
              (user) =>
                user.socketId ===
                socket.id
            );

          if (!isMember) {
            logger.warn(
              `Unauthorized WebRTC offer from ${socket.id}`
            );

            return;
          }

          logger.info(
            `WebRTC offer: ${socket.id} -> room ${code}`
          );

          socket
            .to(code)
            .emit(
              'webrtc-offer',
              {
                fromSocketId:
                  socket.id,

                offer,
              }
            );
        } catch (err) {
          logger.error(
            `WebRTC offer error: ${err.message}`
          );
        }
      }
    );

    /* ========================================================
       WEBRTC ANSWER
    ======================================================== */

    socket.on(
      'webrtc-answer',
      ({
        roomCode,
        answer,
      } = {}) => {
        try {
          const code =
            (roomCode || '')
              .toUpperCase()
              .trim();

          if (!code || !answer) {
            logger.warn(
              `Invalid WebRTC answer from ${socket.id}`
            );

            return;
          }

          const room =
            rooms.get(code);

          if (!room) {
            logger.warn(
              `WebRTC answer for unknown room ${code}`
            );

            return;
          }

          const isMember =
            room.users.some(
              (user) =>
                user.socketId ===
                socket.id
            );

          if (!isMember) {
            logger.warn(
              `Unauthorized WebRTC answer from ${socket.id}`
            );

            return;
          }

          logger.info(
            `WebRTC answer: ${socket.id} -> room ${code}`
          );

          socket
            .to(code)
            .emit(
              'webrtc-answer',
              {
                fromSocketId:
                  socket.id,

                answer,
              }
            );
        } catch (err) {
          logger.error(
            `WebRTC answer error: ${err.message}`
          );
        }
      }
    );

    /* ========================================================
       WEBRTC ICE CANDIDATE
    ======================================================== */

    socket.on(
      'webrtc-ice-candidate',
      ({
        roomCode,
        candidate,
      } = {}) => {
        try {
          const code =
            (roomCode || '')
              .toUpperCase()
              .trim();

          if (!code || !candidate) {
            logger.warn(
              `Invalid ICE candidate from ${socket.id}`
            );

            return;
          }

          const room =
            rooms.get(code);

          if (!room) {
            logger.warn(
              `ICE candidate for unknown room ${code}`
            );

            return;
          }

          const isMember =
            room.users.some(
              (user) =>
                user.socketId ===
                socket.id
            );

          if (!isMember) {
            logger.warn(
              `Unauthorized ICE candidate from ${socket.id}`
            );

            return;
          }

          logger.info(
            `ICE candidate: ${socket.id} -> room ${code}`
          );

          socket
            .to(code)
            .emit(
              'webrtc-ice-candidate',
              {
                fromSocketId:
                  socket.id,

                candidate,
              }
            );
        } catch (err) {
          logger.error(
            `ICE candidate error: ${err.message}`
          );
        }
      }
    );

    /* ========================================================
       DISCONNECT
    ======================================================== */

    socket.on(
      'disconnect',
      () => {
        logger.info(
          `Socket disconnected: ${socket.id}`
        );

        for (
          const [
            code,
            room,
          ] of rooms.entries()
        ) {
          const before =
            room.users.length;

          room.users =
            room.users.filter(
              (user) =>
                user.socketId !==
                socket.id
            );

          if (
            room.users.length !==
            before
          ) {
            io.to(code).emit(
              'user-left',
              {
                socketId:
                  socket.id,

                room:
                  publicRoom(room),
              }
            );
          }

          if (
            room.users.length === 0
          ) {
            scheduleRoomDeletion(
              code,
              io
            );
          }
        }
      }
    );
  });

  /* ==========================================================
     EXPIRED ROOM CLEANUP
  ========================================================== */

  setInterval(() => {
    const now = Date.now();

    for (
      const [
        code,
        room,
      ] of rooms.entries()
    ) {
      if (
        now > room.expiresAt
      ) {
        io.to(code).emit(
          'room-expired'
        );

        if (room._deleteTimer) {
          clearTimeout(
            room._deleteTimer
          );
        }

        rooms.delete(code);

        logger.info(
          `Room ${code} expired and removed`
        );
      }
    }
  }, 60 * 1000);

  return io;
}