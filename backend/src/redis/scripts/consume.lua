-- Lock a reservation for checkout: RESERVED -> CHECKING_OUT, and push its deadline out so it
-- cannot expire (and have its stock handed to someone else) while the DB transaction runs.
--
-- KEYS[1] resv:{reservationId}
-- KEYS[2] resv:user:{userId}:{productId}
-- KEYS[3] resv:expiry
-- ARGV[1] reservationId   ARGV[2] userId   ARGV[3] nowMs
-- ARGV[4] checkoutDeadlineMs   ARGV[5] hashTtlMs   ARGV[6] userKeyTtlMs
--
-- Returns {1, productId, qty, price} on success, {0, errorCode} on rejection.

local d = redis.call('HMGET', KEYS[1], 'status', 'userId', 'expiresAt', 'productId', 'qty', 'price')
local status = d[1]

-- Someone else's reservation is reported as not found: don't leak its existence
if not status or d[2] ~= ARGV[2] then
  return {0, 'RESERVATION_NOT_FOUND'}
end
if status == 'RELEASED' then
  return {0, 'RESERVATION_EXPIRED'}
end
if status == 'CHECKING_OUT' then
  return {0, 'CHECKOUT_IN_PROGRESS'}
end
if status ~= 'RESERVED' then
  return {0, 'RESERVATION_NOT_FOUND'}
end
if tonumber(d[3]) <= tonumber(ARGV[3]) then
  -- Past its deadline but not swept yet: the sweeper will return the stock
  return {0, 'RESERVATION_EXPIRED'}
end

redis.call('HMSET', KEYS[1], 'status', 'CHECKING_OUT', 'expiresAt', ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[5])
redis.call('PEXPIRE', KEYS[2], ARGV[6])
redis.call('ZADD', KEYS[3], ARGV[4], ARGV[1])

return {1, d[4], d[5], d[6]}
