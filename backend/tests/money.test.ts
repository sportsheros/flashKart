import { fromCents, multiplyMoney, toCents } from '../src/lib/money';

describe('money', () => {
  it('parses decimal strings into exact cents', () => {
    expect(toCents('0.1')).toBe(10n);
    expect(toCents('2499.50')).toBe(249950n);
    expect(toCents('7')).toBe(700n);
  });

  it('multiplies without float drift', () => {
    // 0.1 * 3 in JS floats is 0.30000000000000004
    expect(multiplyMoney('0.10', 3)).toBe('0.30');
    expect(multiplyMoney('1999.99', 3)).toBe('5999.97');
    expect(fromCents(5n)).toBe('0.05');
  });

  it('rejects malformed amounts', () => {
    expect(() => toCents('1.999')).toThrow();
    expect(() => toCents('-1')).toThrow();
    expect(() => multiplyMoney('1.00', 1.5)).toThrow();
  });
});
