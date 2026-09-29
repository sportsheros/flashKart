import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.string().default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().default('postgres://flashkart:flashkart@localhost:5432/flashkart'),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(20),
  RUN_MIGRATIONS_ON_BOOT: bool.default('true'),

  REDIS_URL: z.string().default('redis://localhost:6379'),

  RESERVATION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  // Hash outlives expiresAt so the sweeper can still read it and return the stock
  RESERVATION_GRACE_SECONDS: z.coerce.number().int().positive().default(60),
  CHECKOUT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
  SWEEPER_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  RATE_LIMIT_PER_SECOND: z.coerce.number().int().positive().default(10),
});

export const env = schema.parse(process.env);
export type Env = typeof env;
