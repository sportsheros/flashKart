import type { SaleStatus } from '../hooks/useSaleStatus';
import { formatDuration } from '../lib/format';

interface Props {
  status: SaleStatus;
  msLeft: number;
}

export function SaleCountdown({ status, msLeft }: Props) {
  if (status === 'ended') return <p className="sale-countdown sale-countdown--ended">Sale ended</p>;
  return (
    <p className={`sale-countdown sale-countdown--${status}`}>
      {status === 'upcoming' ? 'Starts in ' : 'Ends in '}
      <strong>{formatDuration(msLeft)}</strong>
    </p>
  );
}
