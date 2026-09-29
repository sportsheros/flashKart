import { useState } from 'react';
import type { Product } from '../api/types';
import { useReservation } from '../hooks/useReservation';
import { useSaleStatus } from '../hooks/useSaleStatus';
import { useStockPolling } from '../hooks/useStockPolling';
import { formatMoney } from '../lib/format';
import { AddToCartButton } from './AddToCartButton';
import { ReservationTimer } from './ReservationTimer';
import { SaleCountdown } from './SaleCountdown';
import { StockBadge } from './StockBadge';

interface Props {
  product: Product;
}

export function ProductCard({ product }: Props) {
  const sale = useSaleStatus(product.saleStartsAt, product.saleEndsAt);
  const { stock, refresh } = useStockPolling(product.id, product.stock, { enabled: sale.status !== 'ended' });
  const { phase, reservation, order, notice, reserve, checkout, expire, startOver } = useReservation(product.id, refresh);
  const [quantity, setQuantity] = useState(1);

  const maxQty = Math.max(1, Math.min(product.maxPerUser, stock));
  const disabledReason =
    sale.status === 'upcoming' ? 'Sale not started'
    : sale.status === 'ended' ? 'Sale ended'
    : stock <= 0 ? 'Sold out'
    : null;

  return (
    <article className="card">
      {product.imageUrl && <img className="card__image" src={product.imageUrl} alt="" loading="lazy" />}
      <div className="card__body">
        <header className="card__header">
          <h2 className="card__title">{product.name}</h2>
          <StockBadge stock={stock} />
        </header>
        <p className="card__desc">{product.description}</p>
        <div className="card__meta">
          <span className="card__price">{formatMoney(product.price)}</span>
          <SaleCountdown status={sale.status} msLeft={sale.msLeft} />
        </div>

        {(phase === 'idle' || phase === 'reserving') && (
          <div className="card__actions">
            {product.maxPerUser > 1 && (
              <label className="qty">
                Qty
                <select
                  value={Math.min(quantity, maxQty)}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  disabled={phase === 'reserving' || disabledReason !== null}
                >
                  {Array.from({ length: maxQty }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <AddToCartButton
              pending={phase === 'reserving'}
              disabledReason={disabledReason}
              onClick={() => void reserve(Math.min(quantity, maxQty))}
            />
          </div>
        )}

        {(phase === 'reserved' || phase === 'checking_out') && reservation && (
          <div className="card__reservation">
            <ReservationTimer expiresAt={reservation.expiresAt} onExpire={expire} />
            <button
              type="button"
              className="btn btn--checkout"
              onClick={() => void checkout()}
              disabled={phase === 'checking_out'}
              aria-busy={phase === 'checking_out'}
            >
              {phase === 'checking_out'
                ? 'Placing order…'
                : `Checkout ${reservation.quantity} × ${formatMoney(reservation.unitPrice)}`}
            </button>
          </div>
        )}

        {phase === 'ordered' && order && (
          <div className="card__order">
            <p>
              Order <code>{order.orderId.slice(0, 8)}</code> confirmed: {order.quantity} × {formatMoney(order.unitPrice)} ={' '}
              <strong>{formatMoney(order.totalAmount)}</strong>
            </p>
            <button type="button" className="btn btn--link" onClick={startOver}>
              Done
            </button>
          </div>
        )}

        {notice && <p className={`notice notice--${notice.kind}`}>{notice.text}</p>}
      </div>
    </article>
  );
}
