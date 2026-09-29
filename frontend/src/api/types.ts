export interface Product {
  id: string;
  sku: string;
  name: string;
  description: string;
  imageUrl: string | null;
  price: string;
  maxPerUser: number;
  saleStartsAt: string;
  saleEndsAt: string;
  stock: number;
}

export type ReservationStatus = 'RESERVED' | 'CHECKING_OUT' | 'RELEASED';

export interface Reservation {
  reservationId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  status: ReservationStatus;
  expiresAt: string;
}

export interface Order {
  orderId: string;
  reservationId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  totalAmount: string;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED';
  createdAt: string;
}

export interface WithServerTime {
  serverTime: string;
}
