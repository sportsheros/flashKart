import { useEffect, useRef } from 'react';
import { useCountdown } from '../hooks/useCountdown';
import { formatDuration } from '../lib/format';

interface Props {
  expiresAt: string;
  totalMs?: number;
  onExpire: () => void;
}

export function ReservationTimer({ expiresAt, totalMs = 5 * 60_000, onExpire }: Props) {
  const remaining = useCountdown(Date.parse(expiresAt));
  const fired = useRef(false);

  useEffect(() => {
    if (remaining === 0 && !fired.current) {
      fired.current = true;
      onExpire();
    }
  }, [remaining, onExpire]);

  const urgent = remaining < 60_000;
  const pct = Math.min(100, (remaining / totalMs) * 100);
  return (
    <div className={`reservation-timer${urgent ? ' reservation-timer--urgent' : ''}`} role="timer" aria-live="polite">
      <div className="reservation-timer__label">
        Held for you: <strong>{formatDuration(remaining)}</strong>
      </div>
      <div className="reservation-timer__bar">
        <div className="reservation-timer__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
