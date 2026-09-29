import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, USER_ID } from '../api/client';
import * as api from '../api/flashSale';
import type { Order, Reservation } from '../api/types';
import { serverNow } from '../lib/clock';
import { loadJson, removeKey, saveJson } from '../lib/storage';

export type Phase = 'idle' | 'reserving' | 'reserved' | 'checking_out' | 'ordered';

export interface Notice {
  kind: 'info' | 'success' | 'error';
  text: string;
}

/** What survives a refresh. The idempotency key is minted once per reservation and reused on every retry. */
interface Stored {
  reservation: Reservation;
  idempotencyKey: string;
  order?: Order;
}

interface State {
  phase: Phase;
  stored: Stored | null;
  notice: Notice | null;
}

const MESSAGES: Record<string, string> = {
  OUT_OF_STOCK: 'Sold out.',
  ALREADY_RESERVED: 'You already hold a reservation for this item (maybe in another tab).',
  SALE_NOT_ACTIVE: 'The sale is not live right now.',
  RESERVATION_EXPIRED: 'Your reservation expired and the item went back on sale.',
  RESERVATION_NOT_FOUND: 'Your reservation is no longer valid.',
  RATE_LIMITED: 'Too many requests, try again in a second.',
  QUANTITY_LIMIT_EXCEEDED: 'That is more than the per-customer limit.',
  SERVICE_UNAVAILABLE: 'The store is busy. Please try again.',
  NETWORK_ERROR: 'Network error, please retry.',
};

const describe = (err: unknown) =>
  err instanceof ApiError ? (MESSAGES[err.code] ?? err.message) : 'Something went wrong. Please retry.';
const codeOf = (err: unknown) => (err instanceof ApiError ? err.code : 'UNKNOWN');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function initialState(storageKey: string): State {
  const stored = loadJson<Stored>(storageKey);
  if (stored?.order) return { phase: 'ordered', stored, notice: null };
  if (stored && Date.parse(stored.reservation.expiresAt) > serverNow()) {
    return { phase: 'reserved', stored, notice: null };
  }
  if (stored) removeKey(storageKey);
  return { phase: 'idle', stored: null, notice: null };
}

export function useReservation(productId: string, onStockChanged?: () => void) {
  const storageKey = `flashkart:${USER_ID}:${productId}`;
  const [state, setState] = useState<State>(() => initialState(storageKey));
  // Synchronous guard: two clicks in the same tick both see the old React state
  const inFlight = useRef(false);

  const persist = useCallback(
    (stored: Stored | null) => (stored ? saveJson(storageKey, stored) : removeKey(storageKey)),
    [storageKey],
  );

  const clear = useCallback(
    (notice: Notice | null) => {
      persist(null);
      setState({ phase: 'idle', stored: null, notice });
      onStockChanged?.();
    },
    [persist, onStockChanged],
  );

  const runCheckout = useCallback(
    async (stored: Stored) => {
      setState((s) => ({ ...s, phase: 'checking_out', notice: null }));
      // Retrying with the SAME key is safe: the server returns the original order instead of a second one
      for (let attempt = 0; ; attempt++) {
        try {
          const { order } = await api.checkout(stored.reservation.reservationId, stored.idempotencyKey);
          const done = { ...stored, order };
          persist(done);
          setState({ phase: 'ordered', stored: done, notice: { kind: 'success', text: 'Order confirmed!' } });
          return;
        } catch (err) {
          const code = codeOf(err);
          const retryable = code === 'CHECKOUT_IN_PROGRESS' || code === 'NETWORK_ERROR' || code === 'SERVICE_UNAVAILABLE';
          if (retryable && attempt < 3) {
            await sleep(400 * 2 ** attempt);
            continue;
          }
          if (['RESERVATION_EXPIRED', 'RESERVATION_NOT_FOUND', 'OUT_OF_STOCK'].includes(code)) {
            clear({ kind: 'error', text: describe(err) });
          } else {
            // Reservation may still be valid: let the user press checkout again (same key)
            setState((s) => ({ ...s, phase: 'reserved', notice: { kind: 'error', text: describe(err) } }));
          }
          return;
        }
      }
    },
    [persist, clear],
  );

  // After a refresh, re-validate the stored reservation against the server (the source of truth)
  useEffect(() => {
    const stored = state.stored;
    if (!stored || stored.order) return;
    let cancelled = false;
    api
      .getReservation(stored.reservation.reservationId)
      .then((fresh) => {
        if (cancelled) return;
        const updated = { ...stored, reservation: { ...stored.reservation, ...fresh } };
        persist(updated);
        if (fresh.status === 'CHECKING_OUT') {
          // Refreshed mid-checkout: resume it with the same idempotency key
          inFlight.current = true;
          void runCheckout(updated).finally(() => (inFlight.current = false));
        } else {
          setState((s) => ({ ...s, stored: updated }));
        }
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
          clear({ kind: 'info', text: describe(err) });
        }
      });
    return () => {
      cancelled = true;
    };
    // Only on mount: later changes come from this hook's own actions
  }, []);

  const reserve = useCallback(
    async (quantity: number) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setState((s) => ({ ...s, phase: 'reserving', notice: null }));
      try {
        const reservation = await api.reserve(productId, quantity);
        const stored: Stored = { reservation, idempotencyKey: crypto.randomUUID() };
        persist(stored);
        setState({ phase: 'reserved', stored, notice: { kind: 'success', text: 'Reserved! Check out before the timer runs out.' } });
        onStockChanged?.();
      } catch (err) {
        setState({ phase: 'idle', stored: null, notice: { kind: 'error', text: describe(err) } });
        if (codeOf(err) === 'OUT_OF_STOCK') onStockChanged?.();
      } finally {
        inFlight.current = false;
      }
    },
    [productId, persist, onStockChanged],
  );

  const checkout = useCallback(async () => {
    if (inFlight.current || !state.stored || state.phase !== 'reserved') return;
    inFlight.current = true;
    try {
      await runCheckout(state.stored);
    } finally {
      inFlight.current = false;
    }
  }, [state.stored, state.phase, runCheckout]);

  /** Timer hit zero. Ignored mid-checkout: the server extended the reservation for it. */
  const expire = useCallback(() => {
    if (state.phase !== 'reserved') return;
    clear({ kind: 'info', text: MESSAGES.RESERVATION_EXPIRED });
  }, [state.phase, clear]);

  const startOver = useCallback(() => clear(null), [clear]);

  return {
    phase: state.phase,
    reservation: state.stored?.reservation ?? null,
    order: state.stored?.order ?? null,
    notice: state.notice,
    reserve,
    checkout,
    expire,
    startOver,
  };
}
