import { useCountdown } from './useCountdown';

export type SaleStatus = 'upcoming' | 'live' | 'ended';

/** Derives the sale phase from server time; re-renders on its own when the sale opens or closes. */
export function useSaleStatus(saleStartsAt: string, saleEndsAt: string): { status: SaleStatus; msLeft: number } {
  const toStart = useCountdown(Date.parse(saleStartsAt), 1000);
  const toEnd = useCountdown(Date.parse(saleEndsAt), 1000);
  if (toStart > 0) return { status: 'upcoming', msLeft: toStart };
  if (toEnd > 0) return { status: 'live', msLeft: toEnd };
  return { status: 'ended', msLeft: 0 };
}
