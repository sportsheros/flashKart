-- Return a reservation's units to stock. Idempotent: only a RESERVED (or, in FORCE mode,
-- CHECKING_OUT) reservation gives stock back, so double release can never inflate stock.
--
-- KEYS[1] resv:{reservationId}
-- KEYS[2] stock:{productId}
-- KEYS[3] resv:user:{userId}:{productId}
-- KEYS[4] resv:expiry
-- ARGV[1] reservationId
-- ARGV[2] mode: 'EXPIRED' (sweeper; only if past expiresAt) | 'FORCE' (checkout failed / reclaimed)
-- ARGV[3] nowMs
-- ARGV[4] tombstoneTtlMs (how long to remember RELEASED so checkout can answer 410, not 404)
--
-- Returns the number of units returned to stock (0 when nothing was released).

local data = redis.call('HMGET', KEYS[1], 'status', 'qty', 'expiresAt')
local status = data[1]
local qty = tonumber(data[2])
local expiresAt = tonumber(data[3])

if not status then
  redis.call('ZREM', KEYS[4], ARGV[1])
  return 0
end

if ARGV[2] == 'EXPIRED' then
  if status ~= 'RESERVED' or expiresAt > tonumber(ARGV[3]) then
    return 0
  end
elseif status ~= 'RESERVED' and status ~= 'CHECKING_OUT' then
  redis.call('ZREM', KEYS[4], ARGV[1])
  return 0
end

redis.call('INCRBY', KEYS[2], qty)
redis.call('HSET', KEYS[1], 'status', 'RELEASED')
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('ZREM', KEYS[4], ARGV[1])
-- Only clear the user's slot if it still points at this reservation (they may have a newer one)
if redis.call('GET', KEYS[3]) == ARGV[1] then
  redis.call('DEL', KEYS[3])
end

return qty
