-- Release a lock only if we still own it (compare-and-delete), so an instance whose lock
-- already expired can't delete a lock another instance has since acquired.
--
-- KEYS[1] lock key   ARGV[1] owner token
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
