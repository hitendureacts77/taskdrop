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

/**
 * The plain message for an amount that is outside the limits, in the same words the post flow uses (W3-11),
 * or null when it is fine. Shown beside the box; what the person typed is never rewritten.
 */
export function priceNote(rupees: number | null | undefined): string | null {
  const s = priceState(rupees);
  if (s === 'empty' || s === 'low') return `The lowest price is ₹${MIN_PRICE_INR.toLocaleString('en-IN')}`;
  if (s === 'high') return `The most is ₹${MAX_PRICE_INR.toLocaleString('en-IN')}`;
  return null;
}
