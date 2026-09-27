import { env } from './env.js';

// Support comma-separated list of allowed origins via CLIENT_URL
const allowedOrigins = env.CLIENT_URL.split(',').map((o) => o.trim());

export const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, server-to-server health checks)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    return callback(new Error(`CORS: Origin ${origin} is not allowed`));
  },
  methods: ['GET', 'POST'],
  credentials: true,
};

export const socketCorsOptions = {
  origin: allowedOrigins,
  methods: ['GET', 'POST'],
  credentials: true,
};
