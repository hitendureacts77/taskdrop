/**
 * B97: now and then the database gateway signs a short-lived token a moment
 * "in the future" compared with the database's own clock, and answers 401
 * "JWT issued at future". Nothing is wrong with the key; asking again a second
 * later works. This fetch wrapper does that ask-again for the Supabase client,
 * so one clock tick does not fail a whole background step.
 */

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const SKEW_TEXT = /jwt issued at future/i;

/** True when a 401 reply body is the clock-skew refusal and nothing else. */
export function isClockSkewBody(body: string): boolean {
  return SKEW_TEXT.test(body);
}

/**
 * Wraps a fetch: a 401 whose body says "JWT issued at future" is retried after
 * a short wait (up to `retries` times). Any other reply, including every other
 * 401, passes through untouched.
 */
export function clockSkewFetch(
  inner: FetchLike,
  opts: { retries?: number; waitMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): FetchLike {
  const retries = opts.retries ?? 3;
  const waitMs = opts.waitMs ?? 1200;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  return async (input, init) => {
    for (let attempt = 0; ; attempt++) {
      const res = await inner(input, init);
      if (res.status !== 401 || attempt >= retries) return res;
      const body = await res.clone().text().catch(() => "");
      if (!isClockSkewBody(body)) return res;
      await sleep(waitMs * (attempt + 1));
    }
  };
}
