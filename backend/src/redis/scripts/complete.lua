-- Finalise a reservation after its order committed in Postgres. Stock stays consumed.
--
-- KEYS[1] resv:{reservationId}
-- KEYS[2] stock:{productId}
-- KEYS[3] resv:user:{userId}:{productId}
-- KEYS[4] resv:expiry
-- ARGV[1] reservationId
--
-- Returns 1 when the reservation was finalised, 2 when stock had to be re-taken, 0 if already gone.

local d = redis.call('HMGET', KEYS[1], 'status', 'qty')
local status = d[1]
if not status then
  redis.call('ZREM', KEYS[4], ARGV[1])
  return 0
end

local result = 1
if status == 'RELEASED' then
  -- The sweeper reclaimed this reservation while a slow checkout was committing. The order is
  -- real (DB committed), so take the units back out of Redis to keep it in line with the DB.
  redis.call('DECRBY', KEYS[2], tonumber(d[2]))
  result = 2
end

redis.call('DEL', KEYS[1])
if redis.call('GET', KEYS[3]) == ARGV[1] then
  redis.call('DEL', KEYS[3])
end
redis.call('ZREM', KEYS[4], ARGV[1])

return result
