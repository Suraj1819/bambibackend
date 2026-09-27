import { Router } from 'express';
import { healthCheck, createRoomHandler, getRoomHandler } from '../controllers/roomController.js';

const router = Router();

router.get('/health', healthCheck);
router.post('/rooms', createRoomHandler);
router.get('/rooms/:roomCode', getRoomHandler);

export default router;
