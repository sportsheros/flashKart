import Redis from 'ioredis';
import { env } from './env';
import { logger } from './logger';
import { registerScripts } from '../redis/scripts';

export function createRedis(url: string = env.REDIS_URL): Redis {
  const redis = new Redis(url, {
    // Fail fast instead of queueing: a reserve must fail closed when Redis is unavailable
    maxRetriesPerRequest: 1,
    commandTimeout: 2000,
    enableAutoPipelining: true,
  });
  redis.on('error', (err) => logger.error({ err }, 'redis error'));
  registerScripts(redis);
  return redis;
}
