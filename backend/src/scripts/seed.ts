import 'reflect-metadata';
import { AppDataSource } from '../config/data-source';
import { logger } from '../config/logger';
import { createRedis } from '../config/redis';
import { Product } from '../entities/Product';
import { User } from '../entities/User';
import { redisKeys } from '../redis/keys';
import { DEMO_USER_IDS, LOAD_USER_COUNT, LOADTEST_SKU, deleteByPattern, loadUserId } from './fixtures';

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

/** Resets Postgres + Redis to a known demo state. Destructive: local/dev use only. */
async function seed(): Promise<void> {
  await AppDataSource.initialize();
  await AppDataSource.runMigrations({ transaction: 'each' });
  const redis = createRedis();

  await AppDataSource.query('TRUNCATE orders, cart_items, carts, products, users RESTART IDENTITY CASCADE');
  for (const pattern of ['stock:*', 'resv:*', 'idem:*', 'rl:*', 'lock:*']) await deleteByPattern(redis, pattern);

  const users: Partial<User>[] = [
    ...DEMO_USER_IDS.map((id, i) => ({ id, email: `demo${i + 1}@flashkart.test`, name: `Demo User ${i + 1}` })),
    ...Array.from({ length: LOAD_USER_COUNT }, (_, i) => ({
      id: loadUserId(i),
      email: `load${i}@flashkart.test`,
      name: `Load User ${i}`,
    })),
  ];
  await AppDataSource.getRepository(User).insert(users);

  const products = await AppDataSource.getRepository(Product).save([
    {
      sku: 'FK-HEADPHONES-01',
      name: 'Aurora ANC Headphones',
      description: 'Wireless noise-cancelling headphones, 40h battery.',
      imageUrl: 'https://picsum.photos/seed/headphones/480/320',
      price: '1999.00',
      stock: 100,
      maxPerUser: 2,
      saleStartsAt: minutes(-1),
      saleEndsAt: minutes(120),
    },
    {
      sku: 'FK-WATCH-01',
      name: 'Pulse Smartwatch',
      description: 'AMOLED display, GPS, 7-day battery.',
      imageUrl: 'https://picsum.photos/seed/watch/480/320',
      price: '2499.50',
      stock: 5,
      maxPerUser: 1,
      saleStartsAt: minutes(-1),
      saleEndsAt: minutes(60),
    },
    {
      sku: 'FK-KEYBOARD-01',
      name: 'Clicky Mechanical Keyboard',
      description: 'Hot-swappable switches, aluminium case. Sale opens shortly.',
      imageUrl: 'https://picsum.photos/seed/keyboard/480/320',
      price: '899.99',
      stock: 50,
      maxPerUser: 1,
      saleStartsAt: minutes(2),
      saleEndsAt: minutes(120),
    },
    {
      sku: LOADTEST_SKU,
      name: 'Load Test Widget',
      description: 'Used by `npm run loadtest`.',
      imageUrl: null,
      price: '10.00',
      stock: 100,
      maxPerUser: 1,
      saleStartsAt: minutes(-1),
      saleEndsAt: minutes(120),
    },
  ]);

  // Load stock into the hot path. Upcoming sales are loaded too; the sale window check gates them.
  const pipeline = redis.pipeline();
  for (const p of products) pipeline.set(redisKeys.stock(p.id), p.stock);
  await pipeline.exec();

  logger.info(
    { users: users.length, products: products.map((p) => `${p.sku}=${p.stock}`), demoUserId: DEMO_USER_IDS[0] },
    'seed complete',
  );
  await redis.quit();
  await AppDataSource.destroy();
}

seed().catch((err) => {
  logger.fatal({ err }, 'seed failed');
  process.exit(1);
});
