import * as roomService from '../services/roomService.js';

export function healthCheck(req, res) {
  res.json({
    success: true,
    message: 'WebDrop server is running',
  });
}

export function createRoomHandler(req, res) {
  const room = roomService.createRoom();

  res.status(201).json({
    success: true,
    roomCode: room.roomCode,
    expiresAt: room.expiresAt,
  });
}

export function getRoomHandler(req, res) {
  const { roomCode } = req.params;
  const room = roomService.getRoom(roomCode);

  if (!room) {
    return res.status(404).json({
      success: false,
      message: 'Room not found',
    });
  }

  if (roomService.isRoomExpired(room)) {
    roomService.removeRoom(room.roomCode);
    return res.status(410).json({
      success: false,
      message: 'Room has expired',
    });
  }

  res.json({
    success: true,
    roomCode: room.roomCode,
    deviceCount: room.users.length,
    isFull: roomService.isRoomFull(room),
    expiresAt: room.expiresAt,
  });
}
