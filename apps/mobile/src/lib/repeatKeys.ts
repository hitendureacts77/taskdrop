/**
 * Repeat keys (idempotency keys) for writes.
 *
 * Every write the app sends carries a random key (the Idempotency-Key header).
 * The server does a write once per key and answers any repeat with the first
 * reply (supabase/functions/api/repeat.ts). This file decides which key a
 * write gets:
 *
 * - a new one for a new tap;
 * - the same one while an identical write is still on its way (a double tap
 *   becomes one payment, and both taps get its answer);
 * - the same one again when the last identical write never got a clear answer
 *   (the connection dropped), for up to 10 minutes, so tapping "Pay" again after
 *   a lost answer cannot pay twice. A clear answer, yes or no, ends the key.
 *
 * No React Native imports on purpose, so this can be tested from Node.
 */

import type { Failure } from './retry';

/** JSON with every object's keys in order, so the same write always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableJson(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** The server's answer when the first request with a key is still running (repeat.ts, IN_PROGRESS). */
export const IN_PROGRESS_STATUS = 409;

/**
 * Whether a finished write left its outcome unknown: no answer at all, a gateway page, or "still going through".
 * `null` means the server answered (yes or a refusal), so the outcome is known.
 */
export function outcomeUnknown(f: Failure | null): boolean {
  if (!f) return false;
  if (f.ours) return f.status === IN_PROGRESS_STATUS;
  return true;
}

export class RepeatKeys {
  private kept = new Map<string, { key: string; at: number }>();
  private make: () => string;
  private keepMs: number;
  private now: () => number;
  private max: number;

  // Plain fields, not constructor parameter properties: the Node tests strip types and cannot run those.
  constructor(make: () => string, keepMs = 10 * 60_000, now: () => number = Date.now, max = 20) {
    this.make = make;
    this.keepMs = keepMs;
    this.now = now;
    this.max = max;
  }

  /** The key for this write: the one already in use for the same write, or a new one. */
  take(op: string, args: Record<string, unknown>): string {
    const id = `${op} ${stableJson(args)}`;
    const held = this.kept.get(id);
    if (held && this.now() - held.at < this.keepMs) return held.key;
    const key = this.make();
    this.kept.delete(id);
    this.kept.set(id, { key, at: this.now() });
    // Oldest first in a Map: forget the oldest rather than grow without bound.
    while (this.kept.size > this.max) this.kept.delete(this.kept.keys().next().value as string);
    return key;
  }

  /** The write finished. A clear answer ends its key; an unknown outcome keeps it for the next identical tap. */
  settle(op: string, args: Record<string, unknown>, key: string, unknown: boolean): void {
    const id = `${op} ${stableJson(args)}`;
    if (this.kept.get(id)?.key !== key) return;
    if (unknown) this.kept.set(id, { key, at: this.now() });
    else this.kept.delete(id);
  }
}
