import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { Cart } from '../../entities/Cart';
import { CartItem } from '../../entities/CartItem';
import { CartItemStatus, CartStatus } from '../../entities/enums';
import { Order } from '../../entities/Order';
import { AppError, isErrorCode } from '../../errors/AppError';
import { failClosed } from '../../lib/fail-closed';
import { redisKeys } from '../../redis/keys';
import { runScript, type ScriptReply } from '../../redis/scripts';
import type { ProductService } from '../product/product.service';

export type ReservationStatus = 'RESERVED' | 'CHECKING_OUT' | 'RELEASED';

export interface ReservationView {
  reservationId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  status: ReservationStatus;
  expiresAt: string;
}

export interface LockedReservation {
  reservationId: string;
  userId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
}

export type SweepOutcome = 'released' | 'converted' | 'skipped';

// How long a RELEASED reservation is remembered so checkout can answer 410 instead of 404
const TOMBSTONE_TTL_MS = 10 * 60 * 1000;

const ttlMs = () => env.RESERVATION_TTL_SECONDS * 1000;
const graceMs = () => env.RESERVATION_GRACE_SECONDS * 1000;
const checkoutWindowMs = () => env.CHECKOUT_WINDOW_SECONDS * 1000;

function rejection(reply: ScriptReply): AppError {
  const code = reply[1];
  return new AppError(isErrorCode(code) ? code : 'INTERNAL_ERROR');
}

export class ReservationService {
  // Fire-and-forget DB writes, tracked so shutdown/tests can wait for them
  private readonly pendingWrites = new Set<Promise<void>>();

  constructor(
    private readonly ds: DataSource,
    private readonly redis: Redis,
    private readonly products: ProductService,
    private readonly clock: () => number = Date.now,
  ) {}

  /** A2: atomically take `quantity` units out of Redis stock and hold them for the TTL. */
  async reserve(userId: string, productId: string, quantity: number): Promise<ReservationView> {
    const product = await this.products.getSaleProduct(productId);
    const now = this.clock();
    this.products.assertSaleActive(product, now);
    if (quantity > product.maxPerUser) {
      throw new AppError('QUANTITY_LIMIT_EXCEEDED', `At most ${product.maxPerUser} unit(s) per user`);
    }

    const reservationId = randomUUID();
    const expiresAt = now + ttlMs();

    const reply = await failClosed('reserve', () =>
      runScript<ScriptReply>(
        this.redis,
        'reserve',
        [
          redisKeys.stock(productId),
          redisKeys.reservation(reservationId),
          redisKeys.userReservation(userId, productId),
          redisKeys.expiryIndex,
        ],
        [reservationId, userId, productId, quantity, product.price, now, expiresAt, ttlMs() + graceMs(), ttlMs()],
      ),
    );
    if (reply[0] === 0) throw rejection(reply);

    logger.info({ reservationId, userId, productId, quantity, remaining: reply[1] }, 'stock reserved');

    // Redis already decided; the DB copy is for durability/reporting, so don't make the buyer wait on it
    this.track(
      this.persistReservation({ reservationId, userId, productId, quantity, price: product.price, expiresAt }),
      { reservationId },
    );

    return {
      reservationId,
      productId,
      quantity,
      unitPrice: product.price,
      status: 'RESERVED',
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  async getReservation(userId: string, reservationId: string): Promise<ReservationView> {
    const data = await failClosed('getReservation', () =>
      this.redis.hgetall(redisKeys.reservation(reservationId)),
    );
    if (!data.status || data.userId !== userId) throw new AppError('RESERVATION_NOT_FOUND');

    const expiresAt = Number(data.expiresAt);
    const expired = data.status === 'RELEASED' || (data.status === 'RESERVED' && expiresAt <= this.clock());
    if (expired) throw new AppError('RESERVATION_EXPIRED');

    return {
      reservationId,
      productId: data.productId,
      quantity: Number(data.qty),
      unitPrice: data.price,
      status: data.status as ReservationStatus,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  /** A3 step 3: RESERVED -> CHECKING_OUT so the reservation can't expire mid-transaction. */
  async lockForCheckout(userId: string, reservationId: string): Promise<LockedReservation> {
    const resvKey = redisKeys.reservation(reservationId);
    const productId = await failClosed('lockForCheckout', () => this.redis.hget(resvKey, 'productId'));
    if (!productId) throw new AppError('RESERVATION_NOT_FOUND');

    const now = this.clock();
    const deadline = now + checkoutWindowMs();
    const reply = await failClosed('consume', () =>
      runScript<ScriptReply>(
        this.redis,
        'consume',
        [resvKey, redisKeys.userReservation(userId, productId), redisKeys.expiryIndex],
        [reservationId, userId, now, deadline, checkoutWindowMs() + graceMs(), checkoutWindowMs()],
      ),
    );
    if (reply[0] === 0) throw rejection(reply);

    const [, , qty, price] = reply;
    return { reservationId, userId, productId, quantity: Number(qty), unitPrice: String(price) };
  }

  /** After the order committed: drop the reservation, keep the stock consumed. */
  async finalize(r: Pick<LockedReservation, 'reservationId' | 'userId' | 'productId'>): Promise<void> {
    const result = await runScript<number>(
      this.redis,
      'complete',
      [
        redisKeys.reservation(r.reservationId),
        redisKeys.stock(r.productId),
        redisKeys.userReservation(r.userId, r.productId),
        redisKeys.expiryIndex,
      ],
      [r.reservationId],
    );
    if (result === 2) {
      logger.warn({ reservationId: r.reservationId }, 'checkout committed after sweeper reclaim; stock re-taken');
    }
  }

  /** Checkout failed after locking: give the units back so someone else can buy them. */
  async releaseAfterFailedCheckout(r: Pick<LockedReservation, 'reservationId' | 'userId' | 'productId'>): Promise<number> {
    const returned = await this.release(r.reservationId, r.userId, r.productId, 'FORCE');
    if (returned > 0) this.track(this.markReleasedInDb(r.reservationId), { reservationId: r.reservationId });
    return returned;
  }

  // called by the sweeper. stuck CHECKING_OUT -> check DB if order exists before releasing
  async sweepReservation(reservationId: string): Promise<SweepOutcome> {
    const data = await this.redis.hgetall(redisKeys.reservation(reservationId));
    if (!data.status) {
      await this.redis.zrem(redisKeys.expiryIndex, reservationId);
      return 'skipped';
    }
    const { userId, productId } = data;

    if (data.status === 'CHECKING_OUT') {
      const order = await this.ds.getRepository(Order).findOne({ where: { reservationId }, select: { id: true } });
      if (order) {
        await this.finalize({ reservationId, userId, productId });
        return 'converted';
      }
      const returned = await this.release(reservationId, userId, productId, 'FORCE');
      if (returned > 0) await this.markReleasedInDb(reservationId);
      logger.warn({ reservationId, returned }, 'reclaimed stalled checkout');
      return returned > 0 ? 'released' : 'skipped';
    }

    const returned = await this.release(reservationId, userId, productId, 'EXPIRED');
    if (returned === 0) return 'skipped';
    await this.markReleasedInDb(reservationId);
    logger.info({ reservationId, productId, returned }, 'expired reservation released');
    return 'released';
  }

  /** Wait for in-flight fire-and-forget DB writes (graceful shutdown, tests). */
  async flush(): Promise<void> {
    await Promise.allSettled([...this.pendingWrites]);
  }

  private release(reservationId: string, userId: string, productId: string, mode: 'EXPIRED' | 'FORCE') {
    return runScript<number>(
      this.redis,
      'release',
      [
        redisKeys.reservation(reservationId),
        redisKeys.stock(productId),
        redisKeys.userReservation(userId, productId),
        redisKeys.expiryIndex,
      ],
      [reservationId, mode, this.clock(), TOMBSTONE_TTL_MS],
    );
  }

  private async persistReservation(r: {
    reservationId: string;
    userId: string;
    productId: string;
    quantity: number;
    price: string;
    expiresAt: number;
  }): Promise<void> {
    await this.ds.transaction(async (m) => {
      // Partial unique index allows one ACTIVE cart per user; concurrent reserves share it
      await m
        .createQueryBuilder()
        .insert()
        .into(Cart)
        .values({ userId: r.userId, status: CartStatus.ACTIVE })
        .orIgnore()
        .execute();
      const cart = await m.findOneOrFail(Cart, { where: { userId: r.userId, status: CartStatus.ACTIVE } });
      await m.insert(CartItem, {
        cartId: cart.id,
        productId: r.productId,
        quantity: r.quantity,
        priceAtReservation: r.price,
        reservationId: r.reservationId,
        reservedUntil: new Date(r.expiresAt),
        status: CartItemStatus.RESERVED,
      });
    });
  }

  private async markReleasedInDb(reservationId: string): Promise<void> {
    await this.ds.transaction(async (m) => {
      await m.update(
        CartItem,
        { reservationId, status: CartItemStatus.RESERVED },
        { status: CartItemStatus.RELEASED },
      );
      // Cart expires once nothing in it is still held
      await m.query(
        `UPDATE carts c SET status = 'EXPIRED', updated_at = now()
          WHERE c.id = (SELECT cart_id FROM cart_items WHERE reservation_id = $1)
            AND c.status = 'ACTIVE'
            AND NOT EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id AND ci.status = 'RESERVED')`,
        [reservationId],
      );
    });
  }

  private track(write: Promise<void>, ctx: Record<string, unknown>): void {
    const tracked = write
      .catch((err) => logger.error({ err, ...ctx }, 'reservation DB write failed (Redis state is authoritative)'))
      .finally(() => this.pendingWrites.delete(tracked));
    this.pendingWrites.add(tracked);
  }
}
