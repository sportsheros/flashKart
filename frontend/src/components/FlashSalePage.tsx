import { useCallback, useEffect, useState } from 'react';
import { USER_ID } from '../api/client';
import { getProducts } from '../api/flashSale';
import type { Product } from '../api/types';
import { ProductCard } from './ProductCard';

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; products: Product[] };

export function FlashSalePage() {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  const fetchProducts = useCallback(() => {
    setLoad({ state: 'loading' });
    getProducts()
      .then(({ products }) => setLoad({ state: 'ready', products }))
      .catch((err: Error) => setLoad({ state: 'error', message: err.message }));
  }, []);

  useEffect(fetchProducts, [fetchProducts]);

  return (
    <main className="page">
      <header className="page__header">
        <h1>
          Flash<span>Kart</span> <small>Flash Sale</small>
        </h1>
        <p className="page__user" title="Auth stub: x-user-id header. Use ?user=<uuid> to switch.">
          Signed in as <code>{USER_ID.slice(-4)}</code>
        </p>
      </header>

      {load.state === 'loading' && <p className="page__status">Loading deals…</p>}
      {load.state === 'error' && (
        <div className="page__status">
          <p className="notice notice--error">Couldn’t load the sale: {load.message}</p>
          <button type="button" className="btn" onClick={fetchProducts}>
            Retry
          </button>
        </div>
      )}
      {load.state === 'ready' && (
        <section className="grid">
          {load.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
          {load.products.length === 0 && <p className="page__status">No sales right now. Run `npm run seed`.</p>}
        </section>
      )}
    </main>
  );
}
