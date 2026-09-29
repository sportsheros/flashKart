import { Router } from 'express';
import { env } from '../../config/env';
import type { Container } from '../../container';
import { requireUser } from '../../middleware/auth';
import { rateLimit } from '../../middleware/rate-limit';
import { validateBody } from '../../middleware/validate';
import { CartController, reserveBodySchema } from './cart.controller';

export function cartRoutes({ reservations, redis }: Container): Router {
  const controller = new CartController(reservations);
  const router = Router();
  router.use(requireUser);
  router.post(
    '/reserve',
    rateLimit(redis, 'reserve', env.RATE_LIMIT_PER_SECOND),
    validateBody(reserveBodySchema),
    controller.reserve,
  );
  router.get('/reservations/:reservationId', controller.getReservation);
  return router;
}
