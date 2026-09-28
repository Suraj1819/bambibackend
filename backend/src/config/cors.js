import { env } from './env.js';

// Origins used by the Capacitor Android / iOS WebView.
// Android (Capacitor 6+ default): https://localhost
// Older Capacitor / androidScheme "http": http://localhost
// iOS: capacitor://localhost
const CAPACITOR_ORIGINS = [
  'https://localhost',
  'http://localhost',
  'capacitor://localhost',
];

// Support comma-separated list of allowed origins via CLIENT_URL
const configuredOrigins = env.CLIENT_URL
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

export const allowedOrigins = [
  ...new Set([...configuredOrigins, ...CAPACITOR_ORIGINS]),
];

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