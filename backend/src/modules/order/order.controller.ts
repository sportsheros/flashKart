import type { Request, Response } from 'express';
import { z } from 'zod';
import { AppError } from '../../errors/AppError';
import { currentUserId } from '../../middleware/auth';
import type { CheckoutService } from './checkout.service';

export const checkoutBodySchema = z.object({
  reservationId: z.string().uuid(),
});

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

export class OrderController {
  constructor(private readonly checkoutService: CheckoutService) {}

  checkout = async (req: Request, res: Response): Promise<void> => {
    const key = req.header('Idempotency-Key');
    if (!key) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
    if (!IDEMPOTENCY_KEY_RE.test(key)) {
      throw new AppError('VALIDATION_ERROR', 'Idempotency-Key must be 8-128 chars of [A-Za-z0-9_-]');
    }
    const { reservationId } = req.body as z.infer<typeof checkoutBodySchema>;

    const { order, replayed } = await this.checkoutService.checkout(currentUserId(req), reservationId, key);

    // 201 for the first success, 200 + marker header for a replay of the same request
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(replayed ? 200 : 201).json({ serverTime: new Date().toISOString(), order });
  };
}
