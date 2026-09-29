import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/** Replaces `req.body` with the parsed (typed, stripped) value; ZodError goes to the error handler. */
export const validateBody =
  (schema: ZodTypeAny) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    req.body = schema.parse(req.body ?? {});
    next();
  };
