import type { NextFunction, Request, Response } from 'express';
import { logger } from '../config/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info(
      { method: req.method, url: req.originalUrl, status: res.statusCode, ms: Math.round(ms * 10) / 10, userId: req.userId },
      'request',
    );
  });
  next();
}
