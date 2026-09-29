# CLAUDE.md — FlashKart (Tech Lead Hands-on Assessment)

## What this project is
FlashKart is a high-concurrency flash sale backend + minimal React UI, built for a
**2-hour, 100-mark Tech Lead machine test**. Thousands of users try to buy limited stock at
the same instant. Non-negotiables: **no overselling, high performance, data consistency,
scalability, clean architecture.** Code must be production quality; anything not built in
time must be explained in `docs/`.

Required stack: **Node.js, React.js, TypeORM, Redis.** Chosen extras: TypeScript, Express,
PostgreSQL, Vite, Docker Compose. (Deployment target may be AWS: EC2/ECS + RDS Postgres +
ElastiCache Redis + ALB.)

## Marks → priority (spend time in this order)
| Section | Marks | What to deliver |
|---|---|---|
| A2 Stock reservation `POST /cart/reserve` | 25 | Redis Lua atomic reserve, 5-min TTL, errors |
| A3 Checkout `POST /order/checkout` | 20 | TypeORM transaction + idempotency key |
| C System design (C1 10k rps, C2 consistency) | 20 | `docs/SYSTEM_DESIGN.md` + diagram |
| B React flash sale page | 15 | Key components, state + expiry handling |
| A1 Entities | 10 | User, Product, Cart, CartItem, Order |
| D Debugging (D1 oversell, D2 duplicate checkout) | 10 | `docs/DEBUGGING.md` |

Rough 2h budget: setup 10m → A1 15m → A2 30m → A3 25m → B 20m → C+D docs 15m → review 5m.
If time runs short, finish A2/A3 fully and write the rest as explanation — never leave
half-broken code.

## Repo layout
```
flashkart/
├── CLAUDE.md
├── docker-compose.yml          # postgres:16, redis:7
├── backend/
│   └── src/
│       ├── app.ts / server.ts
│       ├── config/             # env, data-source.ts (TypeORM), redis.ts (ioredis)
│       ├── entities/           # User, Product, Cart, CartItem, Order
│       ├── redis/scripts/      # reserve.lua, release.lua, consume.lua
│       ├── modules/
│       │   ├── cart/           # cart.routes.ts, cart.controller.ts, reservation.service.ts
│       │   └── order/          # order.routes.ts, order.controller.ts, checkout.service.ts
│       ├── jobs/               # reservation-sweeper.ts (returns expired stock)
│       ├── middleware/         # auth (x-user-id stub), validate (zod), error handler
│       └── errors/             # AppError + error codes
├── frontend/
│   └── src/
│       ├── api/                # fetch wrappers
│       ├── hooks/              # useCountdown, useReservation, useStockPolling
│       └── components/         # FlashSalePage, ProductCard, StockBadge, SaleCountdown,
│                               # AddToCartButton, ReservationTimer
└── docs/
    ├── DESIGN.md               # A1 assumptions, API contracts, trade-offs
    ├── SYSTEM_DESIGN.md        # C1 + C2, mermaid architecture diagram
    └── DEBUGGING.md            # D1 + D2
```

## Commands
```bash
docker compose up -d                      # postgres + redis
cd backend && npm i && npm run dev        # ts-node-dev on :4000
npm run seed                              # seed products; also sets Redis stock:{id}
npm test                                  # jest; includes concurrency test
cd frontend && npm i && npm run dev       # vite on :5173
```
Concurrency proof (keep this, reviewers love it): `npm run loadtest` — fires e.g. 500
parallel reserves at a product with stock 100 and asserts exactly 100 succeed and
Redis/DB stock never goes below 0.

## Core design rules (do not break these)

### Stock model
- **Postgres `products.stock` is the source of truth.** Add a DB `CHECK (stock >= 0)`.
- **Redis `stock:{productId}`** is the hot, fast gate. Seeded from DB when the sale starts.
- Redis blocks overselling at reserve time; the DB conditional update blocks it again at
  checkout (defense in depth).

### Redis keys
| Key | Type | Purpose |
|---|---|---|
| `stock:{productId}` | string (int) | available units |
| `resv:{reservationId}` | hash `{userId, productId, qty, status, expiresAt}` | reservation, TTL 300s + grace |
| `resv:user:{userId}:{productId}` | string → reservationId | one active reservation per user per product |
| `resv:expiry` | zset (score = expiresAt ms) | sweeper finds expired reservations |
| `idem:{idempotencyKey}` | string | fast-path duplicate checkout guard, `SET NX EX` |

### A2 — `POST /cart/reserve` `{ productId, quantity }`
- One **Lua script** (`reserve.lua`) does everything atomically: check user has no active
  reservation → check `stock >= qty` → `DECRBY` → `HSET` reservation → `EXPIRE` →
  `ZADD resv:expiry` → set user key. Redis runs Lua single-threaded, so no other command
  interleaves → no race, no lost update. Never do GET-then-DECR from Node.
- Load scripts once with `SCRIPT LOAD` / ioredis `defineCommand`; call via `EVALSHA`.
- TTL expiry alone does **not** return stock. `jobs/reservation-sweeper.ts` runs every
  ~5s: `ZRANGEBYSCORE resv:expiry 0 now` → `release.lua` per id (idempotent: only
  `INCRBY` if status is still `RESERVED`). Use a Redis lock (`SET NX PX`) so only one
  instance sweeps.
- Also persist reservation to DB (`cart_items` with `reservedUntil`, cart status) —
  async/after Redis success is fine; Redis decides.
- Response `201 { reservationId, productId, quantity, expiresAt }`.

### A3 — `POST /order/checkout` `{ reservationId }` + header `Idempotency-Key`
1. Require `Idempotency-Key` (400 if missing). If an order with that key already exists →
   return the **same order** with 200 (not an error).
2. `SET idem:{key} PROCESSING NX EX 60` — if it fails and no order exists yet → 409
   `CHECKOUT_IN_PROGRESS`.
3. `consume.lua`: verify reservation exists, belongs to user, status `RESERVED` → set
   `CHECKING_OUT` and extend TTL so it can't expire mid-checkout.
4. `dataSource.transaction(async (m) => { ... })`:
   - `UPDATE products SET stock = stock - :qty WHERE id = :id AND stock >= :qty` → if
     `affected !== 1` throw `OUT_OF_STOCK`.
   - Insert `Order` (status `CONFIRMED`, `idempotencyKey`, `reservationId`).
   - Mark cart/cart items `CHECKED_OUT`.
5. On commit: delete reservation keys (stock stays consumed), `ZREM`, set
   `idem:{key}` → orderId (EX 24h).
6. On any failure: rollback, `release.lua` returns stock to Redis, delete `idem:{key}`,
   return meaningful error.
- **Real duplicate guard = DB unique constraints** on `orders.idempotency_key` and
  `orders.reservation_id`. Catch Postgres `23505` → fetch and return existing order.
  Redis idem key is only the fast path.

### Error format & codes
`{ "error": { "code": "OUT_OF_STOCK", "message": "..." } }`
| Code | HTTP |
|---|---|
| VALIDATION_ERROR / IDEMPOTENCY_KEY_REQUIRED | 400 |
| RESERVATION_NOT_FOUND | 404 |
| OUT_OF_STOCK, ALREADY_RESERVED, CHECKOUT_IN_PROGRESS | 409 |
| RESERVATION_EXPIRED | 410 |
| SALE_NOT_ACTIVE | 422 |
| RATE_LIMITED | 429 |

## A1 — Entity conventions
- UUID PKs, `createdAt`/`updatedAt` (`@CreateDateColumn`/`@UpdateDateColumn`), enum status.
- `User` (email unique) 1—N `Cart`, 1—N `Order`.
- `Product`: `sku` unique, `price` as `numeric(12,2)` (never float), `stock` int with
  check ≥ 0, `saleStartsAt`, `saleEndsAt`, `@VersionColumn` optional; index on
  `(saleStartsAt, saleEndsAt)`.
- `Cart`: status `ACTIVE | CHECKED_OUT | EXPIRED`; index `(userId, status)`.
- `CartItem`: `quantity`, `priceAtReservation`, `reservationId` unique, `reservedUntil`,
  status `RESERVED | RELEASED | CONVERTED`; index `(productId, status)`, `(reservedUntil)`.
- `Order`: `idempotencyKey` unique, `reservationId` unique, `totalAmount` numeric,
  status `PENDING | CONFIRMED | FAILED | CANCELLED`; index `(userId, createdAt)`.
- `synchronize: false` in anything beyond local; use migrations. Write assumptions in
  `docs/DESIGN.md` (e.g., one product per flash-sale reservation, max qty per user).

## B — React conventions
- Function components + hooks; no Redux needed — local state + small custom hooks (say
  why in docs: state is page-scoped; mention React Query as the scale-up option).
- **Server time is the truth.** API returns `serverTime`, `saleEndsAt`, `expiresAt`;
  compute clock offset once, countdowns use `Date.now() + offset`.
- `useCountdown(targetTs)` with a single `setInterval` cleaned up on unmount.
- Stock: poll `GET /products/:id/stock` every 2–3s (mention SSE/WebSocket for scale).
- Add to Cart: disabled while pending / out of stock / sale inactive / already reserved;
  prevents double-click. On `RESERVATION_EXPIRED` or timer hits 0 → clear reservation,
  show message, re-enable button. Persist `reservationId` in `sessionStorage` so refresh
  keeps the timer.
- Checkout button generates the `Idempotency-Key` **once per reservation** (uuid stored
  with the reservation), so refresh/retry resends the same key.

## C & D — what the docs must cover
- **C1 (10k rps):** ALB → stateless Node instances (autoscale, PM2/cluster), Redis as hot
  path (Lua, pipelining, Redis Cluster/replica), rate limiting per user/IP, Postgres with
  connection pooling (PgBouncer), read replicas for product reads, CDN for static/product
  data, optional queue (SQS/BullMQ) to smooth checkout writes. Mermaid diagram.
- **C2 (consistency):** Redis = atomic gate, DB = final truth with conditional update +
  check constraint; eventual consistency between Redis stock and DB; reconciliation job
  (`redisStock = dbStock − activeReservations`). Redis down → fail closed for reserves
  (or fallback to DB `SELECT … FOR UPDATE`), AOF persistence + replica failover. DB down →
  reservations still expire and release; checkout fails and releases.
- **D1 (stock 100, orders 120):** root cause = non-atomic read-check-write (GET stock,
  check, then DECR/UPDATE) under concurrency, or reservation expiry returning stock that
  a slow checkout then also consumed. Fix = Lua atomic reserve + conditional DB update +
  `CHECK (stock >= 0)` + `CHECKING_OUT` state.
- **D2 (refresh → two orders):** Idempotency-Key per reservation from client, Redis
  `SET NX`, unique DB constraints on idempotency_key/reservation_id, return existing
  order on replay, disable button client-side.

## Coding standards
- TypeScript strict. Controllers thin; logic in services; Redis scripts in `.lua` files.
- Validate every request body with zod. Money as `numeric`/string, never JS float math.
- No `console.log` in final code — use a small logger (pino). Log reservationId/orderId.
- Auth is stubbed via `x-user-id` header — state this assumption clearly.
- Every tricky block gets a one-line "why" comment (reviewers grade explanation of
  trade-offs, not just code).
- Before finishing: run tests + load test, make sure `docs/` answers every section
  heading of the assessment.