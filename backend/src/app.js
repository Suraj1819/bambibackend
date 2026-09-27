import express from 'express';
import cors from 'cors';
import { corsOptions } from './config/cors.js';
import roomRoutes from './routes/roomRoutes.js';
import { notFound } from './middleware/notFound.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(cors(corsOptions));
app.use(express.json());

app.use('/api', roomRoutes);

app.use(notFound);
app.use(errorHandler);

export default app;
