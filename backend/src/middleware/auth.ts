import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../errors/AppError';

declare module 'express-serve-static-core' {
  interface Request {
    userId?: string;
  }
}

const userIdSchema = z.string().uuid();

// auth is stubbed for now: user id comes from x-user-id header
export function requireUser(req: Request, _res: Response, next: NextFunction): void {
  const parsed = userIdSchema.safeParse(req.header('x-user-id'));
  if (!parsed.success) throw new AppError('UNAUTHORIZED');
  req.userId = parsed.data;
  next();
}

export function currentUserId(req: Request): string {
  if (!req.userId) throw new AppError('UNAUTHORIZED');
  return req.userId;
}
