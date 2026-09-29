import { useEffect, useState } from 'react';
import { serverNow } from '../lib/clock';

const remainingUntil = (targetMs: number | null) => (targetMs === null ? 0 : Math.max(0, targetMs - serverNow()));

// ms left until targetMs (server time). one interval, cleaned up on unmount
export function useCountdown(targetMs: number | null, tickMs = 250): number {
  const [remaining, setRemaining] = useState(() => remainingUntil(targetMs));

  useEffect(() => {
    setRemaining(remainingUntil(targetMs));
    if (targetMs === null) return;
    const id = window.setInterval(() => {
      const left = remainingUntil(targetMs);
      setRemaining(left);
      if (left === 0) window.clearInterval(id);
    }, tickMs);
    return () => window.clearInterval(id);
  }, [targetMs, tickMs]);

  return remaining;
}
