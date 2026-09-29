import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { redisKeys } from '../redis/keys';
import { runScript } from '../redis/scripts';
import type { ReservationService, SweepOutcome } from '../modules/cart/reservation.service';

const BATCH_SIZE = 500;

// redis TTL does not give stock back, so this job releases expired reservations
export async function sweepOnce(
  redis: Redis,
  reservations: ReservationService,
  now: number = Date.now(),
): Promise<Record<SweepOutcome, number>> {
  const counts: Record<SweepOutcome, number> = { released: 0, converted: 0, skipped: 0 };

  // Only one instance sweeps per tick; the others skip instead of racing on the same ids
  const token = randomUUID();
  const lockTtl = Math.max(env.SWEEPER_INTERVAL_MS * 2, 10_000);
  const locked = await redis.set(redisKeys.sweeperLock, token, 'PX', lockTtl, 'NX');
  if (!locked) return counts;

  try {
    const ids = await redis.zrangebyscore(redisKeys.expiryIndex, 0, now, 'LIMIT', 0, BATCH_SIZE);
    for (const id of ids) {
      try {
        counts[await reservations.sweepReservation(id)] += 1;
      } catch (err) {
        // One bad reservation must not stall the rest; it stays in the zset for the next tick
        logger.error({ err, reservationId: id }, 'failed to sweep reservation');
      }
    }
    if (counts.released || counts.converted) logger.info(counts, 'reservation sweep done');
    return counts;
  } finally {
    await runScript(redis, 'unlock', [redisKeys.sweeperLock], [token]).catch(() => undefined);
  }
}

export function startReservationSweeper(redis: Redis, reservations: ReservationService): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return; // never overlap ticks on a slow sweep
    running = true;
    sweepOnce(redis, reservations)
      .catch((err) => logger.error({ err }, 'reservation sweep failed'))
      .finally(() => {
        running = false;
      });
  }, env.SWEEPER_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
