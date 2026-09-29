import 'reflect-metadata';
import { createApp } from './app';
import { AppDataSource } from './config/data-source';
import { env } from './config/env';
import { logger } from './config/logger';
import { createRedis } from './config/redis';
import { buildContainer } from './container';
import { startReservationSweeper } from './jobs/reservation-sweeper';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  if (env.RUN_MIGRATIONS_ON_BOOT) {
    const ran = await AppDataSource.runMigrations({ transaction: 'each' });
    if (ran.length) logger.info({ migrations: ran.map((m) => m.name) }, 'migrations applied');
  }

  const redis = createRedis();
  const container = buildContainer(AppDataSource, redis);
  await container.products.warmStockCache();

  const app = createApp(container);
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT }, 'FlashKart API listening'));
  const stopSweeper = startReservationSweeper(redis, container.reservations);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    stopSweeper();
    server.close();
    // Let in-flight fire-and-forget cart writes land before closing the pool
    await container.reservations.flush();
    await Promise.allSettled([redis.quit(), AppDataSource.destroy()]);
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
