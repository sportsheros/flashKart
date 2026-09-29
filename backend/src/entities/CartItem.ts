import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { CartItemStatus } from './enums';
import type { Cart } from './Cart';
import type { Product } from './Product';

/** Durable record of a Redis reservation (written after Redis accepts it). */
@Entity({ name: 'cart_items' })
@Unique('UQ_cart_items_reservation_id', ['reservationId'])
@Check('CHK_cart_items_quantity_positive', '"quantity" > 0')
@Index('IDX_cart_items_product_status', ['productId', 'status'])
@Index('IDX_cart_items_reserved_until', ['reservedUntil'])
export class CartItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'cart_id', type: 'uuid' })
  cartId: string;

  @ManyToOne('Cart', (cart: Cart) => cart.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'cart_id' })
  cart: Relation<Cart>;

  @Column({ name: 'product_id', type: 'uuid' })
  productId: string;

  @ManyToOne('Product', { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'product_id' })
  product: Relation<Product>;

  @Column({ type: 'int' })
  quantity: number;

  // Price is locked at reservation time so a mid-sale price change can't surprise the buyer
  @Column({ name: 'price_at_reservation', type: 'numeric', precision: 12, scale: 2 })
  priceAtReservation: string;

  @Column({ name: 'reservation_id', type: 'uuid' })
  reservationId: string;

  @Column({ name: 'reserved_until', type: 'timestamptz' })
  reservedUntil: Date;

  @Column({ type: 'enum', enum: CartItemStatus, enumName: 'cart_item_status', default: CartItemStatus.RESERVED })
  status: CartItemStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
