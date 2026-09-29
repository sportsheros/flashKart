// Money is handled as integer cents in BigInt: JS floats can't represent 0.1 exactly.

const MONEY_RE = /^(\d+)(?:\.(\d{1,2}))?$/;

export function toCents(amount: string): bigint {
  const match = MONEY_RE.exec(amount.trim());
  if (!match) throw new Error(`Invalid money amount: "${amount}"`);
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
}

export function fromCents(cents: bigint): string {
  const digits = cents.toString().padStart(3, '0');
  return `${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

export function multiplyMoney(amount: string, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 0) throw new Error(`Invalid quantity: ${quantity}`);
  return fromCents(toCents(amount) * BigInt(quantity));
}
