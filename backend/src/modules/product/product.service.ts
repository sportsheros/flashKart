import type Redis from 'ioredis';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { logger } from '../../config/logger';
import { Product } from '../../entities/Product';
import { AppError } from '../../errors/AppError';
import { redisKeys } from '../../redis/keys';

export interface SaleProduct {
  id: string;
  sku: string;
  name: string;
  description: string;
  imageUrl: string | null;
  price: string;
  maxPerUser: number;
  saleStartsAt: Date;
  saleEndsAt: Date;
}

export interface ProductView extends Omit<SaleProduct, 'saleStartsAt' | 'saleEndsAt'> {
  saleStartsAt: string;
  saleEndsAt: string;
  stock: number;
}

const CACHE_TTL_MS = 5_000;

export class ProductService {
  private readonly repo: Repository<Product>;
  // Sale metadata barely changes; caching it in-process keeps the reserve hot path off Postgres.
  // The promise is cached (not the value) so a burst of misses shares one query, no stampede.
  private readonly cache = new Map<string, { value: Promise<SaleProduct>; expiresAt: number }>();

  constructor(
    ds: DataSource,
    private readonly redis: Redis,
  ) {
    this.repo = ds.getRepository(Product);
  }

  getSaleProduct(productId: string): Promise<SaleProduct> {
    const hit = this.cache.get(productId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const value = this.repo.findOne({ where: { id: productId } }).then((product) => {
      if (!product) throw new AppError('PRODUCT_NOT_FOUND');
      return toSaleProduct(product);
    });
    this.cache.set(productId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    // Never cache failures (unknown id, DB blip): the next request should retry
    value.catch(() => {
      if (this.cache.get(productId)?.value === value) this.cache.delete(productId);
    });
    return value;
  }

  assertSaleActive(product: SaleProduct, now: number): void {
    if (now < product.saleStartsAt.getTime() || now >= product.saleEndsAt.getTime()) {
      throw new AppError('SALE_NOT_ACTIVE');
    }
  }

  async list(): Promise<ProductView[]> {
    const products = await this.repo.find({ order: { saleStartsAt: 'ASC', name: 'ASC' } });
    if (products.length === 0) return [];
    const stocks = await this.redis.mget(products.map((p) => redisKeys.stock(p.id)));
    return products.map((p, i) => toView(p, stocks[i]));
  }

  async getOne(productId: string): Promise<ProductView> {
    const product = await this.repo.findOne({ where: { id: productId } });
    if (!product) throw new AppError('PRODUCT_NOT_FOUND');
    return toView(product, await this.redis.get(redisKeys.stock(product.id)));
  }

  /** Hot endpoint polled by every client: served from Redis, DB only if the key isn't loaded. */
  async getStock(productId: string): Promise<number> {
    const cached = await this.redis.get(redisKeys.stock(productId));
    if (cached !== null) return Math.max(0, Number(cached));
    const product = await this.repo.findOne({ where: { id: productId }, select: { id: true, stock: true } });
    if (!product) throw new AppError('PRODUCT_NOT_FOUND');
    return product.stock;
  }

  // load stock into redis on startup. NX so we never overwrite a live counter
  async warmStockCache(): Promise<number> {
    const products = await this.repo.find({ where: { saleEndsAt: MoreThan(new Date()) } });
    if (products.length === 0) return 0;
    const pipeline = this.redis.pipeline();
    for (const p of products) pipeline.set(redisKeys.stock(p.id), p.stock, 'NX');
    const results = (await pipeline.exec()) ?? [];
    const loaded = results.filter(([, r]) => r === 'OK').length;
    logger.info({ products: products.length, loaded }, 'stock cache warmed');
    return loaded;
  }
}

function toSaleProduct(p: Product): SaleProduct {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    description: p.description,
    imageUrl: p.imageUrl,
    price: p.price,
    maxPerUser: p.maxPerUser,
    saleStartsAt: p.saleStartsAt,
    saleEndsAt: p.saleEndsAt,
  };
}

function toView(p: Product, redisStock: string | null): ProductView {
  const sale = toSaleProduct(p);
  return {
    ...sale,
    saleStartsAt: sale.saleStartsAt.toISOString(),
    saleEndsAt: sale.saleEndsAt.toISOString(),
    // Redis is the live availability; fall back to DB stock before the sale is loaded
    stock: redisStock !== null ? Math.max(0, Number(redisStock)) : p.stock,
  };
}
