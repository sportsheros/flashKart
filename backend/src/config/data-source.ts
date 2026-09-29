import 'reflect-metadata';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { env } from './env';
import { Cart } from '../entities/Cart';
import { CartItem } from '../entities/CartItem';
import { Order } from '../entities/Order';
import { Product } from '../entities/Product';
import { User } from '../entities/User';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: env.DATABASE_URL,
  entities: [User, Product, Cart, CartItem, Order],
  migrations: [path.join(__dirname, '..', 'migrations', '*.{ts,js}')],
  // Schema only changes through reviewed migrations, never auto-sync
  synchronize: false,
  logging: false,
  extra: {
    max: env.DB_POOL_SIZE,
    // A checkout must finish well inside CHECKOUT_WINDOW_SECONDS, or the sweeper may reclaim it
    statement_timeout: 10_000,
    idle_in_transaction_session_timeout: 15_000,
  },
});
