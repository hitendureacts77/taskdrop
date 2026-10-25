import { PRICE_LIMITS } from '@taskdrop/rules';

/** The smallest task budget or offer, in rupees (₹20; the server refuses less, see packages/rules). */
export const MIN_PRICE_INR = PRICE_LIMITS.MIN_MINOR / 100;
