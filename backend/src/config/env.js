import dotenv from 'dotenv';

dotenv.config();

export const env = {
  PORT: parseInt(process.env.PORT || '5000', 10),

  CLIENT_URL: process.env.CLIENT_URL || 'http://localhost:5173',

  CLIENT_URLS: [
    'https://webdrop-eight.vercel.app',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://172.25.6.109:5173',
  ],

  ROOM_EXPIRY_MINUTES: parseInt(
    process.env.ROOM_EXPIRY_MINUTES || '30',
    10
  ),

  MAX_DEVICES_PER_ROOM: parseInt(
    process.env.MAX_DEVICES_PER_ROOM || '2',
    10
  ),

  NODE_ENV: process.env.NODE_ENV || 'development',
};