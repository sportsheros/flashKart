import { useCallback, useEffect, useRef, useState } from 'react';
import { getStock } from '../api/flashSale';

// poll stock with setTimeout (no overlapping requests) + small jitter
export function useStockPolling(
  productId: string,
  initialStock: number,
  { enabled = true, intervalMs = 2500 }: { enabled?: boolean; intervalMs?: number } = {},
): { stock: number; refresh: () => void } {
  const [stock, setStock] = useState(initialStock);
  const refreshRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: number | undefined;
    const controller = new AbortController();

    const poll = async () => {
      window.clearTimeout(timer);
      // Background tabs don't need live stock; skip the request but keep the loop alive
      if (document.visibilityState === 'visible') {
        try {
          const res = await getStock(productId, controller.signal);
          if (!cancelled) setStock(res.stock);
        } catch {
          /* keep the last known value; the next tick retries */
        }
      }
      if (!cancelled) timer = window.setTimeout(poll, intervalMs * (0.8 + Math.random() * 0.4));
    };

    refreshRef.current = () => void poll();
    timer = window.setTimeout(poll, intervalMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [productId, enabled, intervalMs]);

  const refresh = useCallback(() => refreshRef.current(), []);
  return { stock, refresh };
}
