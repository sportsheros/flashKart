/* eslint-disable no-console -- CLI report output */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { AppDataSource } from '../config/data-source';
import { createRedis } from '../config/redis';
import { Order } from '../entities/Order';
import { Product } from '../entities/Product';
import { redisKeys } from '../redis/keys';
import { LOAD_USER_COUNT, LOADTEST_SKU, loadUserId, resetProductForSale } from './fixtures';

// load test: 500 parallel reserves on stock 100, then checkout each winner 3 times with same key
const API = process.env.API_URL ?? 'http://127.0.0.1:4000';
const BUYERS = Math.min(Number(process.env.BUYERS ?? 500), LOAD_USER_COUNT);
const STOCK = Number(process.env.STOCK ?? 100);

interface HttpResult {
  status: number;
  body: any;
  ms: number;
}

// Pooled keep-alive sockets: opening hundreds of fresh TCP connections in the same instant
// overflows the OS accept backlog (esp. on Windows) and measures the kernel, not the API.
const agent = new http.Agent({ keepAlive: true, maxSockets: Number(process.env.SOCKETS ?? 128) });

function post(path: string, userId: string, body: unknown, headers: Record<string, string> = {}): Promise<HttpResult> {
  const started = performance.now();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      `${API}${path}`,
      {
        method: 'POST',
        agent,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          'x-user-id': userId,
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw), ms: performance.now() - started }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const pct = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))].toFixed(1);
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((acc, x) => ({ ...acc, [x]: (acc[x] ?? 0) + 1 }), {});

async function main(): Promise<void> {
  await AppDataSource.initialize();
  const redis = createRedis();
  const failures: string[] = [];
  const check = (ok: boolean, msg: string) => {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!ok) failures.push(msg);
  };

  try {
    const product = await AppDataSource.getRepository(Product).findOneByOrFail({ sku: LOADTEST_SKU });
    await resetProductForSale(AppDataSource, redis, product.id, STOCK);

    // Watch Redis stock while the storm runs, to prove it never dips below zero
    let minStock = STOCK;
    const sampler = setInterval(async () => {
      const v = Number(await redis.get(redisKeys.stock(product.id)));
      minStock = Math.min(minStock, v);
    }, 5);

    console.log(`\nPhase 1: ${BUYERS} concurrent reserves, stock ${STOCK}`);
    const t0 = performance.now();
    const reserves = await Promise.all(
      Array.from({ length: BUYERS }, (_, i) => post('/cart/reserve', loadUserId(i), { productId: product.id, quantity: 1 })),
    );
    const elapsed = performance.now() - t0;
    clearInterval(sampler);

    const winners = reserves
      .map((r, i) => ({ r, userId: loadUserId(i) }))
      .filter(({ r }) => r.status === 201);
    const latencies = reserves.map((r) => r.ms).sort((a, b) => a - b);
    console.log(`  outcomes: ${JSON.stringify(tally(reserves.map((r) => (r.status === 201 ? '201' : r.body.error?.code))))}`);
    console.log(`  wall ${elapsed.toFixed(0)}ms  p50 ${pct(latencies, 50)}ms  p95 ${pct(latencies, 95)}ms  p99 ${pct(latencies, 99)}ms`);

    const redisStockAfterReserve = Number(await redis.get(redisKeys.stock(product.id)));
    check(winners.length === Math.min(STOCK, BUYERS), `exactly ${Math.min(STOCK, BUYERS)} reservations succeeded (got ${winners.length})`);
    check(minStock >= 0, `Redis stock never went below 0 (min observed ${minStock})`);
    check(redisStockAfterReserve === Math.max(0, STOCK - BUYERS), `Redis stock is ${redisStockAfterReserve}`);

    console.log(`\nPhase 2: checkout x3 per reservation with the same Idempotency-Key`);
    const checkoutResults = await Promise.all(
      winners.map(async ({ r, userId }) => {
        const headers = { 'Idempotency-Key': randomUUID() };
        const body = { reservationId: r.body.reservationId };
        // Double-click: two identical requests in flight together, then a refresh-style replay
        const pair = await Promise.all([post('/order/checkout', userId, body, headers), post('/order/checkout', userId, body, headers)]);
        const replay = await post('/order/checkout', userId, body, headers);
        return [...pair, replay];
      }),
    );

    const flat = checkoutResults.flat();
    console.log(`  outcomes: ${JSON.stringify(tally(flat.map((r) => (r.status < 300 ? String(r.status) : r.body.error?.code))))}`);
    const orderIds = new Set(flat.filter((r) => r.status < 300).map((r) => r.body.order.orderId));
    const everyReplayMatches = checkoutResults.every(([, , replay]) => replay.status === 200 && replay.body.order?.orderId);

    const dbProduct = await AppDataSource.getRepository(Product).findOneByOrFail({ id: product.id });
    const dbOrders = await AppDataSource.getRepository(Order).countBy({ productId: product.id });
    const redisStockFinal = Number(await redis.get(redisKeys.stock(product.id)));

    check(orderIds.size === winners.length, `one distinct order per reservation (${orderIds.size})`);
    check(everyReplayMatches, 'every replay returned 200 with the original order');
    check(dbOrders === winners.length, `orders in DB = ${dbOrders}`);
    check(dbProduct.stock === STOCK - winners.length, `DB stock = ${dbProduct.stock} (never oversold)`);
    check(redisStockFinal === dbProduct.stock, `Redis stock (${redisStockFinal}) matches DB stock`);
  } finally {
    agent.destroy();
    await redis.quit();
    await AppDataSource.destroy();
  }

  console.log(failures.length ? `\n${failures.length} check(s) FAILED` : '\nAll checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
