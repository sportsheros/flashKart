import { logger } from '../config/logger';
import { AppError } from '../errors/AppError';

// if redis is down on the stock path, return 503 instead of selling without the check
export async function failClosed<T>(op: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.error({ err, op }, 'redis unavailable on stock path, failing closed');
    throw new AppError('SERVICE_UNAVAILABLE');
  }
}
