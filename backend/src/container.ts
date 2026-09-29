import type Redis from 'ioredis';
import type { DataSource } from 'typeorm';
import { ReservationService } from './modules/cart/reservation.service';
import { CheckoutService } from './modules/order/checkout.service';
import { ProductService } from './modules/product/product.service';

/** Manual composition root: explicit dependencies, trivially swappable in tests. */
export function buildContainer(ds: DataSource, redis: Redis, clock: () => number = Date.now) {
  const products = new ProductService(ds, redis);
  const reservations = new ReservationService(ds, redis, products, clock);
  const checkout = new CheckoutService(ds, redis, reservations);
  return { ds, redis, products, reservations, checkout };
}

export type Container = ReturnType<typeof buildContainer>;
