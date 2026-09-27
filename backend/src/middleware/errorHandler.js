import { logger } from '../utils/logger.js';

export function errorHandler(err, req, res, next) {
  logger.error(err.message, err.stack);

  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal server error',
  });
}
