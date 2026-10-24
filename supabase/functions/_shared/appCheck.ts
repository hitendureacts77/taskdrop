/**
 * Firebase App Check, in monitor mode (Phase 3).
 *
 * The apps send a short-lived token in `X-Firebase-AppCheck` that says "this
 * request comes from the real TaskDrop app" (Play Integrity on Android,
 * reCAPTCHA Enterprise on the web). This module only *reads* that token and
 * answers one word; the caller logs it and refuses nothing. The old app sends
 * no token, so enforcement waits for Phase 9 (ground rule 2), and even then a
 * failed check is a risk signal, never the only gate.
 *
 * Off until the Edge Function secret FIREBASE_PROJECT_NUMBER is set: with no
 * project number there is nothing to check a token against.
 *
 * Verification follows Firebase's custom-backend guide: an RS256 JWT signed
 * with a key from https://firebaseappcheck.googleapis.com/v1/jwks, issuer
 * `https://firebaseappcheck.googleapis.com/<project number>`, audience
 * `projects/<project number>`, not expired.
 */

export const APP_CHECK_HEADER = "x-firebase-appcheck";

export type AppCheckResult = "off" | "missing" | "valid" | "invalid";

export const JWKS_URL = "https://firebaseappcheck.googleapis.com/v1/jwks";

type Jwk = JsonWebKey & { kid?: string };

const b64 = (s: string): Uint8Array => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

const parseJson = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes));

/** The signing keys, kept for an hour per instance (they rotate about every few weeks). */
let keyCache: { at: number; keys: Jwk[] } | null = null;

async function signingKeys(fetchKeys: () => Promise<Jwk[]>, now: number): Promise<Jwk[]> {
  if (keyCache && now - keyCache.at < 3_600_000) return keyCache.keys;
  const keys = await fetchKeys();
  keyCache = { at: now, keys };
  return keys;
}

const fetchGoogleKeys = async (): Promise<Jwk[]> => {
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error(`jwks ${res.status}`);
  return ((await res.json()) as { keys?: Jwk[] }).keys ?? [];
};

/** Forget the cached keys (tests). */
export const resetAppCheckKeys = () => {
  keyCache = null;
};

/**
 * Check a token. `projectNumber` empty means monitoring is off. Never throws:
 * a failure to reach Google's key list counts as "off" for that request, since
 * our own outage of the check must not be mistaken for a bad client.
 */
export async function checkAppCheck(
  token: string | null,
  projectNumber: string,
  opts: { fetchKeys?: () => Promise<Jwk[]>; now?: number } = {},
): Promise<AppCheckResult> {
  if (!projectNumber) return "off";
  if (!token) return "missing";
  const now = opts.now ?? Date.now();
  try {
    const [h, p, s] = token.split(".");
    if (!h || !p || !s) return "invalid";
    const header = parseJson(b64(h)) as { alg?: string; kid?: string };
    const claims = parseJson(b64(p)) as { iss?: string; aud?: string[] | string; exp?: number };
    if (header.alg !== "RS256" || !header.kid) return "invalid";
    if (claims.iss !== `https://firebaseappcheck.googleapis.com/${projectNumber}`) return "invalid";
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(`projects/${projectNumber}`)) return "invalid";
    if (typeof claims.exp !== "number" || claims.exp * 1000 <= now) return "invalid";

    let keys: Jwk[];
    try {
      keys = await signingKeys(opts.fetchKeys ?? fetchGoogleKeys, now);
    } catch {
      return "off";
    }
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return "invalid";
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(s), new TextEncoder().encode(`${h}.${p}`));
    return ok ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

/**
 * Logs a result without flooding the log: an invalid token is always worth a
 * line; "missing" and "valid" at most once a minute per platform and result on
 * each instance, enough to show who passes without one line per request.
 */
export class AppCheckLog {
  private last = new Map<string, number>();
  private everyMs: number;
  constructor(everyMs = 60_000) {
    this.everyMs = everyMs;
  }

  shouldLog(result: AppCheckResult, platform: string, now = Date.now()): boolean {
    if (result === "off") return false;
    if (result === "invalid") return true;
    const key = `${platform}:${result}`;
    const at = this.last.get(key);
    if (at !== undefined && now - at < this.everyMs) return false;
    this.last.set(key, now);
    return true;
  }
}
