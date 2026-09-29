-- Atomically reserve stock for one user. Redis runs a script to completion before any other
-- command, so check-and-decrement cannot interleave with another reserve: no race, no oversell.
--
-- KEYS[1] stock:{productId}
-- KEYS[2] resv:{reservationId}
-- KEYS[3] resv:user:{userId}:{productId}
-- KEYS[4] resv:expiry
-- ARGV[1] reservationId   ARGV[2] userId      ARGV[3] productId   ARGV[4] qty
-- ARGV[5] price           ARGV[6] nowMs       ARGV[7] expiresAtMs
-- ARGV[8] hashTtlMs (ttl + grace)             ARGV[9] userKeyTtlMs (exact ttl)
--
-- Returns {1, remainingStock} on success, {0, errorCode} on rejection.

local qty = tonumber(ARGV[4])

-- The user key lives exactly until expiresAt, so its existence == "user holds a live reservation".
if redis.call('EXISTS', KEYS[3]) == 1 then
  return {0, 'ALREADY_RESERVED'}
end

local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then
  -- Stock is only loaded into Redis for products whose sale is open
  return {0, 'SALE_NOT_ACTIVE'}
end
if stock < qty then
  return {0, 'OUT_OF_STOCK'}
end

local remaining = redis.call('DECRBY', KEYS[1], qty)

redis.call('HMSET', KEYS[2],
  'userId', ARGV[2],
  'productId', ARGV[3],
  'qty', qty,
  'price', ARGV[5],
  'status', 'RESERVED',
  'createdAt', ARGV[6],
  'expiresAt', ARGV[7])
-- Hash outlives expiresAt by a grace period so the sweeper can still read qty and return it
redis.call('PEXPIRE', KEYS[2], ARGV[8])
redis.call('ZADD', KEYS[4], ARGV[7], ARGV[1])
redis.call('SET', KEYS[3], ARGV[1], 'PX', ARGV[9])

return {1, remaining}
