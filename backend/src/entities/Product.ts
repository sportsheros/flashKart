import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';

@Entity({ name: 'products' })
@Unique('UQ_products_sku', ['sku'])
// Last line of defence against overselling: the DB itself refuses negative stock
@Check('CHK_products_stock_non_negative', '"stock" >= 0')
@Check('CHK_products_sale_window', '"sale_ends_at" > "sale_starts_at"')
@Index('IDX_products_sale_window', ['saleStartsAt', 'saleEndsAt'])
export class Product {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64 })
  sku: string;

  @Column({ type: 'varchar', length: 200 })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'image_url', type: 'varchar', length: 500, nullable: true })
  imageUrl: string | null;

  // numeric, never float: pg returns it as a string, money math is done in integer cents
  @Column({ type: 'numeric', precision: 12, scale: 2 })
  price: string;

  /** Source of truth for sellable units. Redis `stock:{id}` is the hot-path mirror. */
  @Column({ type: 'int' })
  stock: number;

  @Column({ name: 'max_per_user', type: 'int', default: 1 })
  maxPerUser: number;

  @Column({ name: 'sale_starts_at', type: 'timestamptz' })
  saleStartsAt: Date;

  @Column({ name: 'sale_ends_at', type: 'timestamptz' })
  saleEndsAt: Date;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
