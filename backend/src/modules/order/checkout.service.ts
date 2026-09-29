import type Redis from 'ioredis';
import { DataSource, In, Repository } from 'typeorm';
import { logger } from '../../config/logger';
import { CartItem } from '../../entities/CartItem';
import { CartItemStatus, OrderStatus } from '../../entities/enums';
import { Order } from '../../entities/Order';
import { Product } from '../../entities/Product';
import { AppError } from '../../errors/AppError';
import { isCheckViolation, isUniqueViolation } from '../../lib/db-errors';
import { failClosed } from '../../lib/fail-closed';
import { multiplyMoney } from '../../lib/money';
import { redisKeys } from '../../redis/keys';
import type { LockedReservation, ReservationService } from '../cart/reservation.service';

export interface OrderView {
  orderId: string;
  reservationId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string;
  status: OrderStatus;
  createdAt: string;
}

export interface CheckoutResult {
  order: OrderView;
  /** true when this request was a retry and the original order is being returned */
  replayed: boolean;
}

// Short: only has to outlive one checkout attempt; a crashed instance must not block the key forever
const IDEM_PROCESSING_TTL_SEC = 60;
const IDEM_DONE_TTL_SEC = 24 * 60 * 60;

export class CheckoutService {
  private readonly orders: Repository<Order>;

  constructor(
    private readonly ds: DataSource,
    private readonly redis: Redis,
    private readonly reservations: ReservationService,
  ) {
    this.orders = ds.getRepository(Order);
  }

  async checkout(userId: string, reservationId: string, idempotencyKey: string): Promise<CheckoutResult> {
    // 1. A retry of a request that already succeeded gets the same order back, not an error
    const existing = await this.findExisting(userId, reservationId, idempotencyKey);
    if (existing) return { order: toView(existing), replayed: true };

    // 2. Fast-path guard: only one in-flight attempt per key across all instances
    const idemKey = redisKeys.idempotency(idempotencyKey);
    const acquired = await failClosed('idempotency', () =>
      this.redis.set(idemKey, 'PROCESSING', 'EX', IDEM_PROCESSING_TTL_SEC, 'NX'),
    );
    if (!acquired) {
      // The winner may have committed between our DB read and SET NX
      const winner = await this.findExisting(userId, reservationId, idempotencyKey);
      if (winner) return { order: toView(winner), replayed: true };
      throw new AppError('CHECKOUT_IN_PROGRESS');
    }

    let locked: LockedReservation | undefined;
    let order: Order;
    try {
      // 3. RESERVED -> CHECKING_OUT: can no longer expire under us
      locked = await this.reservations.lockForCheckout(userId, reservationId);
      // 4. Durable sale in one transaction
      order = await this.createOrder(locked, idempotencyKey);
    } catch (err) {
      return this.handleFailure(err, { userId, reservationId, idempotencyKey, idemKey, locked });
    }

    // 5. Committed: the sale is real now, so post-commit Redis hiccups must never undo it
    await this.afterCommit(locked, idemKey, order.id);
    logger.info({ orderId: order.id, reservationId, userId }, 'order confirmed');
    return { order: toView(order), replayed: false };
  }

  private async createOrder(locked: LockedReservation, idempotencyKey: string): Promise<Order> {
    return this.ds.transaction(async (m) => {
      // Conditional decrement: the DB refuses to go below zero even if Redis was wrong (defence in depth)
      const result = await m
        .createQueryBuilder()
        .update(Product)
        .set({ stock: () => 'stock - :qty' })
        .where('id = :id AND stock >= :qty', { id: locked.productId, qty: locked.quantity })
        .execute();
      if (result.affected !== 1) throw new AppError('OUT_OF_STOCK', 'Sold out while checking out');

      const order = await m.save(
        m.create(Order, {
          userId: locked.userId,
          productId: locked.productId,
          reservationId: locked.reservationId,
          idempotencyKey,
          quantity: locked.quantity,
          unitPrice: locked.unitPrice,
          totalAmount: multiplyMoney(locked.unitPrice, locked.quantity),
          status: OrderStatus.CONFIRMED,
        }),
      );

      // The cart row may be RELEASED if a sweeper reclaimed a stalled checkout that still committed
      await m.update(
        CartItem,
        { reservationId: locked.reservationId, status: In([CartItemStatus.RESERVED, CartItemStatus.RELEASED]) },
        { status: CartItemStatus.CONVERTED },
      );
      await m.query(
        `UPDATE carts c SET status = 'CHECKED_OUT', updated_at = now()
          WHERE c.id = (SELECT cart_id FROM cart_items WHERE reservation_id = $1)
            AND c.status IN ('ACTIVE', 'EXPIRED')
            AND NOT EXISTS (SELECT 1 FROM cart_items ci WHERE ci.cart_id = c.id AND ci.status = 'RESERVED')`,
        [locked.reservationId],
      );
      return order;
    });
  }

  private async afterCommit(locked: LockedReservation, idemKey: string, orderId: string): Promise<void> {
    const results = await Promise.allSettled([
      this.reservations.finalize(locked),
      this.redis.set(idemKey, orderId, 'EX', IDEM_DONE_TTL_SEC),
    ]);
    for (const r of results) {
      if (r.status === 'rejected') {
        // Sweeper sees the stale CHECKING_OUT reservation, finds this order in the DB and finalises it
        logger.error({ err: r.reason, orderId, reservationId: locked.reservationId }, 'post-commit Redis cleanup failed');
      }
    }
  }

  private async handleFailure(
    err: unknown,
    ctx: {
      userId: string;
      reservationId: string;
      idempotencyKey: string;
      idemKey: string;
      locked?: LockedReservation;
    },
  ): Promise<CheckoutResult> {
    // Did it actually commit? (duplicate won the unique constraint, or the connection dropped after COMMIT)
    const committed = await this.findExisting(ctx.userId, ctx.reservationId, ctx.idempotencyKey).catch(() => null);
    if (committed) {
      if (ctx.locked) await this.afterCommit(ctx.locked, ctx.idemKey, committed.id);
      if (!isUniqueViolation(err)) logger.warn({ err, orderId: committed.id }, 'checkout error after commit; returning order');
      return { order: toView(committed), replayed: true };
    }

    // Genuinely failed: undo everything so the buyer (or someone else) can try again
    if (ctx.locked) {
      await this.reservations.releaseAfterFailedCheckout(ctx.locked).catch((releaseErr) =>
        logger.error({ err: releaseErr, reservationId: ctx.reservationId }, 'release after failed checkout failed; sweeper will retry'),
      );
    }
    await this.redis.del(ctx.idemKey).catch(() => undefined);

    if (isCheckViolation(err, 'CHK_products_stock_non_negative')) throw new AppError('OUT_OF_STOCK');
    if (!(err instanceof AppError)) logger.error({ err, reservationId: ctx.reservationId }, 'checkout failed');
    throw err;
  }

  /** Order already produced by this key, or for this reservation under another key. */
  private async findExisting(userId: string, reservationId: string, idempotencyKey: string): Promise<Order | null> {
    const matches = await this.orders.find({ where: [{ idempotencyKey }, { reservationId }] });
    const byKey = matches.find((o) => o.idempotencyKey === idempotencyKey);
    if (byKey) {
      // Same key replayed with a different payload is a client bug, not a retry
      if (byKey.userId !== userId || byKey.reservationId !== reservationId) {
        throw new AppError('IDEMPOTENCY_KEY_CONFLICT');
      }
      return byKey;
    }
    const byReservation = matches.find((o) => o.reservationId === reservationId);
    if (byReservation && byReservation.userId !== userId) throw new AppError('RESERVATION_NOT_FOUND');
    return byReservation ?? null;
  }
}

function toView(o: Order): OrderView {
  return {
    orderId: o.id,
    reservationId: o.reservationId,
    productId: o.productId,
    quantity: o.quantity,
    unitPrice: o.unitPrice,
    totalAmount: o.totalAmount,
    status: o.status,
    createdAt: o.createdAt.toISOString(),
  };
}
