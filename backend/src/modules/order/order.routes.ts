import { Router } from 'express';
import { env } from '../../config/env';
import type { Container } from '../../container';
import { requireUser } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import { validateBody } from '../../middleware/validate';
import { OrderController, checkoutBodySchema } from './order.controller';

export function orderRoutes({ checkout, redis }: Container): Router {
  const controller = new OrderController(checkout);
  const router = Router();
  router.use(requireUser);
  router.post(
    '/checkout',
    rateLimit(redis, 'checkout', env.RATE_LIMIT_PER_SECOND),
    validateBody(checkoutBodySchema),
    controller.checkout,
  );
  return router;
}
