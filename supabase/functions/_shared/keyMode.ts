/**
 * Which kind of Razorpay key a project may hold (migration 127, the
 * `environment` setting).
 *
 * `staging` is fake data and fake money: Razorpay test keys only. `production`
 * is real money: live keys only. A key of the other kind is refused before any
 * money function does anything, so a live key pasted into the staging project
 * (or a test key left in production) fails loudly instead of moving money.
 *
 * Pure on purpose (no Deno imports), so it can be exercised from Node. The part
 * that reads the setting and reports a refusal is in ./keyGuard.ts.
 */

export const ENVIRONMENTS = ["staging", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

/**
 * Read an environment value. Anything that is not exactly "production" is
 * "staging": the safe side, because staging refuses live keys.
 */
export function parseEnvironment(value: unknown): Environment {
  return value === "production" ? "production" : "staging";
}

export type KeyKind = "live" | "test" | "unknown";

/** Razorpay key ids start with `rzp_live_` or `rzp_test_`. */
export function keyKind(keyId: string | null | undefined): KeyKind {
  const id = (keyId ?? "").trim();
  if (id.startsWith("rzp_live_")) return "live";
  if (id.startsWith("rzp_test_")) return "test";
  return "unknown";
}

export type KeyRefusal = {
  /** Plain words, safe to show; never contains the key itself. */
  message: string;
  code: "LIVE_KEY_IN_STAGING" | "TEST_KEY_IN_PRODUCTION" | "UNKNOWN_KEY_KIND";
};

export const LIVE_KEY_IN_STAGING_MESSAGE =
  "This project is the staging environment (fake money) but it holds a live Razorpay key. Payments are stopped. Replace it with a test key (rzp_test_...).";
export const TEST_KEY_IN_PRODUCTION_MESSAGE =
  "This project is the production environment (real money) but it holds a test Razorpay key. Payments are stopped. Replace it with a live key (rzp_live_...).";
export const UNKNOWN_KEY_KIND_MESSAGE =
  "The Razorpay key is neither a test key (rzp_test_...) nor a live key (rzp_live_...). Payments are stopped until it is replaced.";

/**
 * Whether `keyId` may be used in `environment`; null when it may. An empty key
 * is not this guard's business (the caller already says "not configured"), but
 * a key of a kind we cannot tell is refused in both environments.
 */
export function keyRefusal(environment: Environment, keyId: string | null | undefined): KeyRefusal | null {
  if (!(keyId ?? "").trim()) return null;
  const kind = keyKind(keyId);
  if (kind === "unknown") return { message: UNKNOWN_KEY_KIND_MESSAGE, code: "UNKNOWN_KEY_KIND" };
  if (environment === "staging" && kind === "live") return { message: LIVE_KEY_IN_STAGING_MESSAGE, code: "LIVE_KEY_IN_STAGING" };
  if (environment === "production" && kind === "test") return { message: TEST_KEY_IN_PRODUCTION_MESSAGE, code: "TEST_KEY_IN_PRODUCTION" };
  return null;
}
