import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Relation,
  UpdateDateColumn,
} from 'typeorm';
import { CartStatus } from './enums';
import type { CartItem } from './CartItem';
import type { User } from './User';

@Entity({ name: 'carts' })
@Index('IDX_carts_user_status', ['userId', 'status'])
// At most one ACTIVE cart per user; lets concurrent reserves share it via ON CONFLICT DO NOTHING
@Index('UQ_carts_one_active_per_user', ['userId'], { unique: true, where: `"status" = 'ACTIVE'` })
export class Cart {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne('User', (user: User) => user.carts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column({ type: 'enum', enum: CartStatus, enumName: 'cart_status', default: CartStatus.ACTIVE })
  status: CartStatus;

  @OneToMany('CartItem', (item: CartItem) => item.cart)
  items: CartItem[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
