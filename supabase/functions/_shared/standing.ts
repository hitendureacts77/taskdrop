/**
 * Whether a person whose token still checks out may use TaskDrop's server functions (task 2.14, H46).
 *
 * `api` has always asked this on every call; `razorpay`, `razorpayx-payouts` and `places-search` now ask the same
 * question the same way, so a suspended or deleted person's token (valid for up to an hour) stops working everywhere.
 *
 * No Deno imports on purpose, so it can be exercised from Node.
 */

/** Whether a person whose token still checks out may use the server: a suspended or deleted account may not. */
export type Standing = "ok" | "suspended" | "deleted";

/** The slice of a service-role client that `standingOf` reads. */
export interface StandingReader {
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
}

/**
 * Whether the person is suspended (an open row in user_suspensions, migration 071) or deleted (profiles.deleted_at,
 * migrations 087 and 108; no profile row at all means the auth user is gone). Both also set auth.users.banned_until,
 * but that column is not served by the data API and the token check above does not look at it, so this reads the
 * public tables that go with it. Two indexed lookups, asked together. Null when it could not be read: the caller
 * decides (the api lets the request go ahead, like the limiter, and logs it).
 */
export async function standingOf(db: StandingReader, userId: string): Promise<Standing | null> {
  const [suspension, profile] = await Promise.all([
    db.from("user_suspensions").select("id").eq("user_id", userId).is("lifted_at", null).limit(1),
    db.from("profiles").select("deleted_at").eq("id", userId).maybeSingle(),
  ]);
  if (suspension.error || profile.error) return null;
  if (!profile.data || profile.data.deleted_at) return "deleted";
  return (suspension.data?.length ?? 0) > 0 ? "suspended" : "ok";
}

/** The plain-words refusal for a suspended or deleted person: the same wording the api gives. */
export const STANDING_REFUSAL = "Your session has expired. Please sign in again.";

/** True when the person must be refused. A standing that could not be read (null) is not a verdict: the request goes ahead. */
export const mustRefuse = (standing: Standing | null): boolean => standing === "suspended" || standing === "deleted";
