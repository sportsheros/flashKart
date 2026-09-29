interface Props {
  stock: number;
}

export function StockBadge({ stock }: Props) {
  if (stock <= 0) return <span className="badge badge--out">Sold out</span>;
  if (stock <= 10) return <span className="badge badge--low">Only {stock} left</span>;
  return <span className="badge badge--ok">{stock} in stock</span>;
}
