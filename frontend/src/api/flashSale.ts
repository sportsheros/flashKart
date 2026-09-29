import { request } from './client';
import type { Order, Product, Reservation, WithServerTime } from './types';

export const getProducts = () => request<WithServerTime & { products: Product[] }>('/products');

export const getStock = (productId: string, signal?: AbortSignal) =>
  request<WithServerTime & { productId: string; stock: number }>(`/products/${productId}/stock`, { signal });

export const reserve = (productId: string, quantity: number) =>
  request<WithServerTime & Reservation>('/cart/reserve', { method: 'POST', body: { productId, quantity } });

export const getReservation = (reservationId: string) =>
  request<WithServerTime & Reservation>(`/cart/reservations/${reservationId}`);

export const checkout = (reservationId: string, idempotencyKey: string) =>
  request<WithServerTime & { order: Order }>('/order/checkout', {
    method: 'POST',
    body: { reservationId },
    headers: { 'Idempotency-Key': idempotencyKey },
  });
