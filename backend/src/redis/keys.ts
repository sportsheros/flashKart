/** Every Redis key the app touches, in one place. */
export const redisKeys = {
  stock: (productId: string) => `stock:${productId}`,
  reservation: (reservationId: string) => `resv:${reservationId}`,
  userReservation: (userId: string, productId: string) => `resv:user:${userId}:${productId}`,
  expiryIndex: 'resv:expiry',
  idempotency: (key: string) => `idem:${key}`,
  sweeperLock: 'lock:reservation-sweeper',
  rateLimit: (scope: string, subject: string, windowSec: number) => `rl:${scope}:${subject}:${windowSec}`,
} as const;
