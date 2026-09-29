interface Props {
  onClick: () => void;
  pending: boolean;
  disabledReason: string | null;
}

// disabled while request is pending or item not buyable (avoids double click)
export function AddToCartButton({ onClick, pending, disabledReason }: Props) {
  const disabled = pending || disabledReason !== null;
  return (
    <button type="button" className="btn btn--primary" onClick={onClick} disabled={disabled} aria-busy={pending}>
      {pending ? 'Reserving…' : (disabledReason ?? 'Add to cart')}
    </button>
  );
}
