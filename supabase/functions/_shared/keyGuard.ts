import { captureServerError, logServer } from "./monitoring.ts";
import { type Environment, keyKind, keyRefusal, parseEnvironment } from "./keyMode.ts";

/**
 * The money functions' guard on which kind of Razorpay key they hold (the rule
 * itself, and its tests, are in ./keyMode.ts). Call `guardKey` after the keys
 * are found and before anything is sent to Razorpay or written to the books:
 * a non-null answer is the whole response, and nothing has moved.
 */

/** Anything with a Supabase-style `rpc` (the service-role client). */
type Rpc = { rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }> };

/**
 * This project's environment, from the admin panel's controls. If the setting
 * cannot be read the answer is "staging": it refuses live keys, so a failed read
 * can stop payments but can never let a live key through on a staging project.
 */
export async function readEnvironment(db: Rpc, fn: string): Promise<Environment> {
  try {
    const { data, error } = await db.rpc("get_app_controls", { p_platform: null, p_version: null });
    if (error) throw new Error(error.message);
    return parseEnvironment((data as { environment?: unknown } | null)?.environment);
  } catch (e) {
    await logServer("warn", fn, "environment setting unreadable, assuming staging", { error: e instanceof Error ? e.message : String(e) });
    return "staging";
  }
}

export type KeyGuardAnswer = { status: 503; body: { error: string; code: string } };

/**
 * Null when `keyId` is the right kind for this project. Otherwise the plain
 * answer to send (HTTP 503), after the refusal has been logged and sent to
 * Sentry at `fatal`, so someone is told that a wrong key is sitting in the
 * project. The key itself is never logged, only its kind.
 */
export async function guardKey(db: Rpc, fn: string, keyId: string | null | undefined): Promise<KeyGuardAnswer | null> {
  const environment = await readEnvironment(db, fn);
  const refusal = keyRefusal(environment, keyId);
  if (!refusal) return null;
  const kind = keyKind(keyId);
  await Promise.all([
    logServer("error", fn, "refused to start: wrong kind of payment key", { code: refusal.code, environment, key_kind: kind }),
    captureServerError(new Error(refusal.message), { fn, step: "key_mode", code: refusal.code, environment, key_kind: kind }, "fatal"),
  ]);
  return { status: 503, body: { error: refusal.message, code: refusal.code } };
}
