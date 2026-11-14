import { PRICE_LIMITS } from '@taskdrop/rules';

/** The smallest task budget or offer, in rupees (₹20; the server refuses less, see packages/rules). */
export const MIN_PRICE_INR = PRICE_LIMITS.MIN_MINOR / 100;

/** The most a task or an offer may carry, in rupees (₹1,00,000 by default; the server refuses more, see packages/rules). */
export const MAX_PRICE_INR = PRICE_LIMITS.MAX_MINOR / 100;

/** Where an amount typed in rupees stands against the limits. */
export function priceState(rupees: number | null | undefined): 'empty' | 'low' | 'high' | 'ok' {
  if (rupees == null || !Number.isFinite(rupees) || rupees <= 0) return 'empty';
  if (rupees < MIN_PRICE_INR) return 'low';
  if (rupees > MAX_PRICE_INR) return 'high';
  return 'ok';
}
