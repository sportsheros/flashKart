const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' });

// Display only: amounts arrive as exact decimal strings and are never used for arithmetic here
export const formatMoney = (amount: string): string => inr.format(Number(amount));

export function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
