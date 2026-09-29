import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { redisKeys } from '../redis/keys';

/** Fixed ids so the frontend (VITE_USER_ID) and load test can use them without a lookup. */
export const DEMO_USER_IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
];

export const LOAD_USER_COUNT = 1000;
export const loadUserId = (i: number) => `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`;

export const LOADTEST_SKU = 'FK-LOADTEST';

/** Deletes every key matching a pattern with SCAN (never KEYS: it blocks Redis). */
export async function deleteByPattern(redis: Redis, pattern: string): Promise<number> {
  let cursor = '0';
  let deleted = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    if (keys.length) deleted += await redis.del(...keys);
  } while (cursor !== '0');
  return deleted;
}

/** Puts one product back to a clean "sale open, N in stock" state in both Postgres and Redis. */
export async function resetProductForSale(ds: DataSource, redis: Redis, productId: string, stock: number): Promise<void> {
  await ds.transaction(async (m) => {
    await m.query('DELETE FROM orders WHERE product_id = $1', [productId]);
    await m.query('DELETE FROM cart_items WHERE product_id = $1', [productId]);
    await m.query(
      `UPDATE products SET stock = $2, sale_starts_at = now() - interval '1 minute',
         sale_ends_at = now() + interval '2 hours' WHERE id = $1`,
      [productId, stock],
    );
  });

  // Drop live reservations for this product, otherwise the sweeper would later "return" them
  const ids = await redis.zrange(redisKeys.expiryIndex, 0, -1);
  if (ids.length) {
    const lookup = redis.pipeline();
    for (const id of ids) lookup.hmget(redisKeys.reservation(id), 'productId', 'userId');
    const rows = (await lookup.exec()) ?? [];
    const cleanup = redis.pipeline();
    rows.forEach(([, value], i) => {
      const [pid, uid] = value as [string | null, string | null];
      if (pid !== productId) return;
      cleanup.del(redisKeys.reservation(ids[i]));
      if (uid) cleanup.del(redisKeys.userReservation(uid, productId));
      cleanup.zrem(redisKeys.expiryIndex, ids[i]);
    });
    await cleanup.exec();
  }
  await redis.set(redisKeys.stock(productId), stock);
}
