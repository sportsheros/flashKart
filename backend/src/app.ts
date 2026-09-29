import cors from 'cors';
import express, { type Express } from 'express';
import { env } from './config/env';
import type { Container } from './container';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { requestLogger } from './middleware/request-logger';
import { cartRoutes } from './modules/cart/cart.routes';
import { orderRoutes } from './modules/order/order.routes';
import { productRoutes } from './modules/product/product.routes';

export function createApp(container: Container): Express {
  const app = express();
  app.disable('x-powered-by');
  // Behind an ALB: trust X-Forwarded-For so per-IP rate limiting sees the real client
  app.set('trust proxy', 1);

  app.use(cors({ origin: env.CORS_ORIGIN.split(','), allowedHeaders: ['Content-Type', 'x-user-id', 'Idempotency-Key'] }));
  app.use(express.json({ limit: '10kb' }));
  app.use(requestLogger);

  app.get('/health', async (_req, res) => {
    const [db, redis] = await Promise.allSettled([container.ds.query('SELECT 1'), container.redis.ping()]);
    const ok = db.status === 'fulfilled' && redis.status === 'fulfilled';
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'degraded',
      db: db.status === 'fulfilled' ? 'up' : 'down',
      redis: redis.status === 'fulfilled' ? 'up' : 'down',
      serverTime: new Date().toISOString(),
    });
  });

  app.use('/products', productRoutes(container));
  app.use('/cart', cartRoutes(container));
  app.use('/order', orderRoutes(container));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
