/**
 * What each side of a job is told about the money held for it (round 7, W3-1 and W3-2).
 *
 * The poster pays the agreed price plus a service fee, so the held figure (Rs 103 on a Rs 100 job) is the
 * poster's. It was shown to the worker as "held safely" and named as what "goes to the worker" in the
 * release dialog; the worker is paid the agreed price less the commission (Rs 90). The rates come from
 * the live fees (lib/useFees), these are previews and the server prices the real payout.
 */
export type HeldRates = { commission: number; posterFee: number };

/** The agreed price inside what the poster has held: the held figure without the service fee. */
export function agreedMinor(heldMinor: number, posterFee: number, lockedMinor?: number | null): number {
  if (typeof lockedMinor === 'number' && lockedMinor > 0) return lockedMinor;
  return Math.round(heldMinor / (1 + posterFee));
}

/** What the worker is paid for a job whose poster has `heldMinor` held: the agreed price less the commission. */
export function workerEarnsMinor(heldMinor: number, rates: HeldRates, lockedMinor?: number | null): number {
  return Math.round(agreedMinor(heldMinor, rates.posterFee, lockedMinor) * (1 - rates.commission));
}

/** "10%" for a rate of 0.1; no decimals unless the rate has them. */
export function pctWords(rate: number): string {
  const p = Math.round(rate * 1000) / 10;
  return `${p}%`;
}

/** The poster's release question: it names what is held, not who gets all of it. */
export function releaseMessage(heldText: string): string {
  return `${heldText} is held for this job. Releasing it pays the worker (less TaskDrop's commission) and it cannot be taken back. Only do this if the work is done to your satisfaction. If something is wrong, ask for changes or report a problem instead.`;
}
