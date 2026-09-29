export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHORIZED: 401,
  PRODUCT_NOT_FOUND: 404,
  RESERVATION_NOT_FOUND: 404,
  NOT_FOUND: 404,
  OUT_OF_STOCK: 409,
  ALREADY_RESERVED: 409,
  CHECKOUT_IN_PROGRESS: 409,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  RESERVATION_EXPIRED: 410,
  SALE_NOT_ACTIVE: 422,
  QUANTITY_LIMIT_EXCEEDED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const DEFAULT_MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_ERROR: 'Request validation failed',
  IDEMPOTENCY_KEY_REQUIRED: 'Idempotency-Key header is required',
  UNAUTHORIZED: 'Missing or invalid x-user-id header',
  PRODUCT_NOT_FOUND: 'Product not found',
  RESERVATION_NOT_FOUND: 'Reservation not found',
  NOT_FOUND: 'Route not found',
  OUT_OF_STOCK: 'Not enough stock left for this product',
  ALREADY_RESERVED: 'You already hold a reservation for this product',
  CHECKOUT_IN_PROGRESS: 'Checkout for this request is already in progress',
  IDEMPOTENCY_KEY_CONFLICT: 'Idempotency-Key was already used for a different request',
  RESERVATION_EXPIRED: 'Reservation has expired and its stock was released',
  SALE_NOT_ACTIVE: 'The flash sale for this product is not active',
  QUANTITY_LIMIT_EXCEEDED: 'Requested quantity exceeds the per-user limit',
  RATE_LIMITED: 'Too many requests, slow down',
  INTERNAL_ERROR: 'Something went wrong',
  SERVICE_UNAVAILABLE: 'Service temporarily unavailable, please retry',
};

export const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && value in ERROR_STATUS;

export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    message: string = DEFAULT_MESSAGES[code],
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_STATUS[code];
  }
}
