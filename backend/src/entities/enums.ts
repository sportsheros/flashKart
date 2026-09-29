export enum CartStatus {
  ACTIVE = 'ACTIVE',
  CHECKED_OUT = 'CHECKED_OUT',
  EXPIRED = 'EXPIRED',
}

export enum CartItemStatus {
  RESERVED = 'RESERVED',
  RELEASED = 'RELEASED',
  CONVERTED = 'CONVERTED',
}

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
}
