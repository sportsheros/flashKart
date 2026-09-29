// needs docker compose up (uses redis db 15 + test rows in postgres)
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { In } from 'typeorm';
import { AppDataSource } from '../src/config/data-source';
import { createRedis } from '../src/config/redis';
import { buildContainer, type Container } from '../src/container';
import { CartItem } from '../src/entities/CartItem';
import { CartItemStatus } from '../src/entities/enums';
import { Order } from '../src/entities/Order';
import { Product } from '../src/entities/Product';
import { User } from '../src/entities/User';
import { AppError } from '../src/errors/AppError';
import { sweepOnce } from '../src/jobs/reservation-sweeper';
import { redisKeys } from '../src/redis/keys';

const USERS = 300;
const STOCK = 50;

let redis: Redis;
let c: Container;
let fakeNow = Date.now();
let product: Product;
const userIds = Array.from({ length: USERS }, () => randomUUID());

async function errorCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (err) {
    if (err instanceof AppError) return err.code;
    throw err;
  }
}

const redisStock = async () => Number(await redis.get(redisKeys.stock(product.id)));
const dbStock = async () => (await AppDataSource.getRepository(Product).findOneByOrFail({ id: product.id })).stock;

async function setStock(n: number) {
  await AppDataSource.getRepository(Product).update(product.id, { stock: n });
  await redis.set(redisKeys.stock(product.id), n);
}

beforeAll(async () => {
  await AppDataSource.initialize();
  await AppDataSource.runMigrations({ transaction: 'each' });
  redis = createRedis();
  await redis.flushdb();
  c = buildContainer(AppDataSource, redis, () => fakeNow);

  await AppDataSource.getRepository(User).insert(
    userIds.map((id, i) => ({ id, email: `test-${id}@flashkart.test`, name: `Test ${i}` })),
  );
  product = await AppDataSource.getRepository(Product).save({
    sku: `TEST-${randomUUID()}`,
    name: 'Test Product',
    price: '19.99',
    stock: STOCK,
    maxPerUser: 2,
    saleStartsAt: new Date(Date.now() - 60_000),
    saleEndsAt: new Date(Date.now() + 3_600_000),
  });
});

beforeEach(async () => {
  fakeNow = Date.now();
  await c.reservations.flush();
  await AppDataSource.getRepository(Order).delete({ productId: product.id });
  await AppDataSource.getRepository(CartItem).delete({ productId: product.id });
  await redis.flushdb();
  await setStock(STOCK);
});

afterAll(async () => {
  await c.reservations.flush();
  await AppDataSource.getRepository(Order).delete({ productId: product.id });
  await AppDataSource.getRepository(CartItem).delete({ productId: product.id });
  await AppDataSource.query('DELETE FROM carts WHERE user_id = ANY($1)', [userIds]);
  await AppDataSource.getRepository(Product).delete(product.id);
  await AppDataSource.getRepository(User).delete({ id: In(userIds) });
  await redis.flushdb();
  await redis.quit();
  await AppDataSource.destroy();
});

describe('A2: POST /cart/reserve (ReservationService.reserve)', () => {
  it(`lets exactly ${STOCK} of ${USERS} concurrent buyers reserve, never overselling`, async () => {
    const results = await Promise.all(userIds.map((u) => errorCode(c.reservations.reserve(u, product.id, 1))));

    expect(results.filter((r) => r === 'OK')).toHaveLength(STOCK);
    expect(results.filter((r) => r === 'OUT_OF_STOCK')).toHaveLength(USERS - STOCK);
    expect(await redisStock()).toBe(0);
    expect(await redis.zcard(redisKeys.expiryIndex)).toBe(STOCK);
  });

  it('allows only one active reservation per user per product, even when requests race', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => errorCode(c.reservations.reserve(userIds[0], product.id, 1))),
    );
    expect(results.filter((r) => r === 'OK')).toHaveLength(1);
    expect(results.filter((r) => r === 'ALREADY_RESERVED')).toHaveLength(9);
    expect(await redisStock()).toBe(STOCK - 1);
  });

  it('rejects a quantity larger than the remaining stock without touching it', async () => {
    await setStock(1);
    expect(await errorCode(c.reservations.reserve(userIds[0], product.id, 2))).toBe('OUT_OF_STOCK');
    expect(await redisStock()).toBe(1);
  });

  it('persists the reservation to cart_items asynchronously', async () => {
    const r = await c.reservations.reserve(userIds[0], product.id, 2);
    await c.reservations.flush();
    const item = await AppDataSource.getRepository(CartItem).findOneByOrFail({ reservationId: r.reservationId });
    expect(item).toMatchObject({ quantity: 2, priceAtReservation: '19.99', status: CartItemStatus.RESERVED });
  });
});

describe('Reservation expiry (sweeper)', () => {
  it('returns stock of expired reservations and makes checkout answer RESERVATION_EXPIRED', async () => {
    const r = await c.reservations.reserve(userIds[0], product.id, 2);
    expect(await redisStock()).toBe(STOCK - 2);

    // Not expired yet: sweeper leaves it alone
    expect((await sweepOnce(redis, c.reservations, fakeNow)).released).toBe(0);

    fakeNow += 301_000;
    expect((await sweepOnce(redis, c.reservations, fakeNow)).released).toBe(1);
    expect(await redisStock()).toBe(STOCK);

    // Idempotent: a second sweep must not return the units twice
    await sweepOnce(redis, c.reservations, fakeNow);
    expect(await redisStock()).toBe(STOCK);

    expect(await errorCode(c.checkout.checkout(userIds[0], r.reservationId, `key-${randomUUID()}`))).toBe(
      'RESERVATION_EXPIRED',
    );
    await c.reservations.flush();
    const item = await AppDataSource.getRepository(CartItem).findOneByOrFail({ reservationId: r.reservationId });
    expect(item.status).toBe(CartItemStatus.RELEASED);
  });

  it('lets the user reserve again once their expired reservation was released', async () => {
    await c.reservations.reserve(userIds[0], product.id, 1);
    // (In real time the user key's own TTL also lapses at expiresAt; the fake clock can't move Redis's clock)
    fakeNow += 301_000;
    await sweepOnce(redis, c.reservations, fakeNow);
    await expect(c.reservations.reserve(userIds[0], product.id, 1)).resolves.toBeDefined();
    expect(await redisStock()).toBe(STOCK - 1);
  });
});

describe('A3: POST /order/checkout (CheckoutService.checkout)', () => {
  it('creates exactly one order when the same Idempotency-Key is sent concurrently', async () => {
    const r = await c.reservations.reserve(userIds[0], product.id, 2);
    const key = `key-${randomUUID()}`;

    const settled = await Promise.allSettled(
      Array.from({ length: 5 }, () => c.checkout.checkout(userIds[0], r.reservationId, key)),
    );
    const ok = settled.filter((s) => s.status === 'fulfilled').map((s) => s.value);
    const created = ok.filter((x) => !x.replayed);
    expect(created).toHaveLength(1);
    // Losers either got the same order back or were told to retry; never a second order
    for (const x of ok) expect(x.order.orderId).toBe(created[0].order.orderId);
    for (const s of settled) {
      if (s.status === 'rejected') expect((s.reason as AppError).code).toBe('CHECKOUT_IN_PROGRESS');
    }

    // Refresh-style replay afterwards returns the same order
    const replay = await c.checkout.checkout(userIds[0], r.reservationId, key);
    expect(replay).toMatchObject({ replayed: true, order: { orderId: created[0].order.orderId, totalAmount: '39.98' } });

    expect(await AppDataSource.getRepository(Order).countBy({ reservationId: r.reservationId })).toBe(1);
    expect(await dbStock()).toBe(STOCK - 2);
    expect(await redisStock()).toBe(STOCK - 2);
    expect(await redis.exists(redisKeys.reservation(r.reservationId))).toBe(0);
    expect(await redis.get(redisKeys.idempotency(key))).toBe(created[0].order.orderId);
  });

  it('returns the existing order when the same reservation is checked out with a new key', async () => {
    const r = await c.reservations.reserve(userIds[0], product.id, 1);
    const first = await c.checkout.checkout(userIds[0], r.reservationId, `key-${randomUUID()}`);
    const second = await c.checkout.checkout(userIds[0], r.reservationId, `key-${randomUUID()}`);
    expect(second).toMatchObject({ replayed: true, order: { orderId: first.order.orderId } });
    expect(await dbStock()).toBe(STOCK - 1);
  });

  it("does not let a user check out someone else's reservation", async () => {
    const r = await c.reservations.reserve(userIds[0], product.id, 1);
    expect(await errorCode(c.checkout.checkout(userIds[1], r.reservationId, `key-${randomUUID()}`))).toBe(
      'RESERVATION_NOT_FOUND',
    );
  });

  it('rolls back and releases the reservation when the DB refuses the sale (Redis/DB drift)', async () => {
    const r = await c.reservations.reserve(userIds[0], product.id, 1);
    // Simulate drift: DB has no stock although Redis let the reservation through
    await AppDataSource.getRepository(Product).update(product.id, { stock: 0 });
    const key = `key-${randomUUID()}`;

    expect(await errorCode(c.checkout.checkout(userIds[0], r.reservationId, key))).toBe('OUT_OF_STOCK');
    expect(await dbStock()).toBe(0);
    expect(await AppDataSource.getRepository(Order).countBy({ reservationId: r.reservationId })).toBe(0);
    expect(await redisStock()).toBe(STOCK); // unit returned to Redis
    expect(await redis.exists(redisKeys.idempotency(key))).toBe(0); // client may retry
  });

  it('finalises a stalled checkout that did commit instead of returning its stock', async () => {
    const r = await c.reservations.reserve(userIds[0], product.id, 1);
    // Checkout succeeds but post-commit Redis cleanup "fails": reservation left CHECKING_OUT
    const locked = await c.reservations.lockForCheckout(userIds[0], r.reservationId);
    await AppDataSource.getRepository(Order).insert({
      userId: userIds[0],
      productId: product.id,
      reservationId: r.reservationId,
      idempotencyKey: `key-${randomUUID()}`,
      quantity: locked.quantity,
      unitPrice: locked.unitPrice,
      totalAmount: locked.unitPrice,
    });

    fakeNow += 61_000; // past the checkout window
    const counts = await sweepOnce(redis, c.reservations, fakeNow);
    expect(counts.converted).toBe(1);
    expect(await redisStock()).toBe(STOCK - 1); // sold unit is NOT handed back
  });
});
