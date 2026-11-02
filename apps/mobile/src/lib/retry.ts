/**
 * Asking again after a blip.
 *
 * A deploy takes the Edge Functions away for a few seconds, and a weak mobile
 * signal drops a request now and then. Both are over almost at once, so a read
 * that fails that way is asked again, twice, instead of showing an error.
 * Reads travel this road because asking for something twice is harmless. A
 * write (a payment, a bid) travels it only with a repeat key (./repeatKeys.ts):
 * the server does a keyed write once, however many times it arrives.
 *
 * No React Native imports on purpose, so this can be tested from Node.
 */

/** How long to wait before the first and the second repeat. */
export const RETRY_DELAYS_MS: readonly number[] = [400, 1000];

/** The same for a keyed write. Longer, so a write still running on the server has time to finish and answer. */
export const WRITE_RETRY_DELAYS_MS: readonly number[] = [1000, 2500];

/**
 * How long a read may go without an answer before it is given up and asked again. The slowest reads on the
 * test server take about 8 s (a fresh function instance on a busy moment); a reply that has not come in 15 s
 * is treated like a dropped connection, so a lost answer cannot hold a screen on "Loading..." for good.
 * Writes have no limit: giving up on a payment or a bid half way would leave its outcome unknown.
 */
export const READ_TIMEOUT_MS = 15_000;

/** What the failed request looked like from outside. */
export type Failure = {
  /** The HTTP status when the server (or the gateway in front of it) answered. */
  status?: number | null;
  /** The answer was our own `{ ok: false }` reply: the server decided, so asking again changes nothing. */
  ours?: boolean;
  /** No answer at all: offline, dropped, timed out. */
  network?: boolean;
};

/** A gateway or a function that is starting up or shutting down, or a connection that dropped. */
export function isTransient(f: Failure): boolean {
  if (f.ours) return false;
  if (f.network) return true;
  return f.status === 502 || f.status === 503 || f.status === 504;
}

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Run `run`, and run it again after each delay for as long as `again` says the
 * result is a blip. Returns the last result, good or bad; never throws on its own.
 */
export async function retryWhile<R>(
  run: () => Promise<R>,
  again: (result: R) => boolean | Promise<boolean>,
  delaysMs: readonly number[] = RETRY_DELAYS_MS,
  sleep: (ms: number) => Promise<void> = sleepFor,
): Promise<R> {
  let result = await run();
  for (const wait of delaysMs) {
    if (!(await again(result))) break;
    await sleep(wait);
    result = await run();
  }
  return result;
}
