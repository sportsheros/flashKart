import type { NextFunction, Request, Response } from 'express';
import type Redis from 'ioredis';
import { logger } from '../config/logger';
import { AppError } from '../errors/AppError';
import { redisKeys } from '../redis/keys';

// simple per-second limit per user, stored in redis so it works across instances
export function rateLimit(redis: Redis, scope: string, limitPerSecond: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const subject = req.userId ?? req.ip ?? 'anonymous';
    const window = Math.floor(Date.now() / 1000);
    const key = redisKeys.rateLimit(scope, subject, window);
    let count: number;
    try {
      const [[, incr]] = (await redis.multi().incr(key).expire(key, 2).exec()) as [[Error | null, number]];
      count = incr;
    } catch (err) {
      // Limiter is a protection, not a correctness gate: fail open if Redis hiccups
      logger.warn({ err, scope }, 'rate limiter unavailable, allowing request');
      return next();
    }
    if (count > limitPerSecond) {
      res.setHeader('Retry-After', '1');
      throw new AppError('RATE_LIMITED');
    }
    next();
  };
}
