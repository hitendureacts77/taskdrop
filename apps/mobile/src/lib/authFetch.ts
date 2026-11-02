/**
 * Keeps a session alive when Supabase's sign-in limit refuses a renewal (task 2.8b).
 *
 * supabase-js treats only 5xx answers to a session renewal as "try again later". Any other
 * refusal, once the access token has expired, deletes the session and signs the person out.
 * A 429 from Supabase's per-address limit (many people behind one phone-network address) is
 * not a dead session, so it is passed on as a 503: the client keeps the session and renews on
 * its next tick. Every other answer, and a 429 anywhere else, passes through unchanged.
 */

const REFRESH = /\/auth\/v1\/token\?(?:.*&)?grant_type=refresh_token(?:&|$)/;

function urlOf(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function keepSessionOnRateLimit(base?: typeof fetch): typeof fetch {
  return async (input, init) => {
    // The global fetch is looked up per call, so a polyfill installed later is still used.
    const res = await (base ?? fetch)(input, init);
    if (res.status !== 429 || !REFRESH.test(urlOf(input))) return res;
    return new Response(await res.text(), { status: 503, statusText: 'Sign-in limit reached', headers: res.headers });
  };
}
