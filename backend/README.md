# WebDrop Backend

Signaling and room-management server for WebDrop. Built with Node.js, Express, and Socket.IO.

This server **never touches file data**. It only:

- creates/tracks temporary rooms in memory
- relays WebRTC signaling messages (SDP offers/answers, ICE candidates) between two browsers

## Install & Run

```bash
npm install
cp .env.example .env
npm run dev
```

Server starts on `http://localhost:5000` by default.

## REST API

| Method | Route                  | Description                  |
|--------|-------------------------|-------------------------------|
| GET    | `/api/health`           | Health check                  |
| POST   | `/api/rooms`             | Create a new room              |
| GET    | `/api/rooms/:roomCode`   | Check if a room exists         |

## Socket.IO Events

**Room:** `create-room`, `join-room`, `leave-room`, `room-created`, `room-joined`, `user-joined`, `user-left`, `room-error`

**Signaling:** `webrtc-offer`, `webrtc-answer`, `webrtc-ice-candidate`

**Connection:** `peer-connected`, `peer-disconnected`
