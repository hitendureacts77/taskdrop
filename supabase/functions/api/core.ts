/**
 * Shared plumbing for the api function's operations: the context each one runs
 * in, safe error wording, and argument checks.
 *
 * No Deno imports on purpose, so everything under ./ can be exercised from Node.
 */

import type { Client, Controls } from "../_shared/controls.ts";
import type { Fetch as ImageKitFetch, ImageKitConfig } from "../_shared/imagekit.ts";
import type { Standing, StandingReader } from "../_shared/standing.ts";
import type { PublicMemo } from "./publicMemo.ts";

export type DbError = { message: string; code?: string | null; details?: string | null };
export type DbResult = { data: unknown; error: DbError | null; count?: number | null };

/** The slice of a supabase-js client the operations use. */
export interface Db {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<DbResult>;
  // deno-lint-ignore no-explicit-any
  from(table: string): any;
  // deno-lint-ignore no-explicit-any
  storage: { from(bucket: string): any };
}

export type Ctx = {
  /** Runs as the signed-in caller, so row level security applies to every query. */
  db: Db;
  userId: string;
  /** Ask another of our Edge Functions something, as the caller. Best-effort by design. */
  callFunction?: (name: string, body: unknown) => Promise<void>;
  /**
   * Remove files from the caller's own storage folder with the service role.
   * Paths outside `<userId>/` are ignored. Best-effort: a file left behind is
   * untidy, not broken.
   */
  removeOwnFiles?: (paths: string[]) => Promise<void>;
  /**
   * ImageKit, when its keys are configured; null or absent otherwise. Without it,
   * pictures keep going to Supabase Storage exactly as before.
   */
  imagekit?: ImageKitConfig | null;
  /** The fetch used to ask ImageKit about a file. Tests replace it. */
  fetcher?: ImageKitFetch;
  /** Which app is asking (platform and version from the request headers). */
  client?: Client;
  /** The admin panel's switches for this caller (migration 092); null when they could not be read. */
  controls?: Controls | null;
  /** Whether the caller has a confirmed phone number; undefined when unknown. */
  phoneVerified?: boolean;
  /**
   * The server copy's shared answers (plan 3.5b layer D). Used only for the ops on PUBLIC_MEMO_OPS and only while
   * `controls.public_cache_memo` is on; absent, null or off, every op runs as before.
   */
  memo?: PublicMemo | null;
  now?: () => Date;
};

export type Args = Record<string, unknown>;
export type Op = (ctx: Ctx, args: Args) => Promise<unknown>;

/** An error whose message is already safe to show. */
export class OpError extends Error {
  constructor(message: string, readonly code: string = "OP_ERROR", readonly details: string | null = null) {
    super(message);
  }
}

// ------------------------------------------------------------ safe wording --

export const GENERIC = "Something went wrong. Please try again.";

/** What a customer is told about a database failure. Never a table, column or policy name. */
export function safeMessage(err: DbError): string {
  const code = err.code ?? "";
  const raw = err.message ?? "";
  if (code === "P0001") return raw; // raised on purpose by a SQL function, written for the user
  if (code === "42501" || /row-level security|permission denied|violates.*policy/i.test(raw)) {
    return "You do not have permission to do that.";
  }
  if (code === "23505" || /duplicate key|already exists/i.test(raw)) return "That already exists.";
  if (code === "23503") return "That is no longer available.";
  if (["23502", "23514", "22P02", "22001"].includes(code)) return "Please check what you entered and try again.";
  return GENERIC;
}

export function toOpError(err: DbError): OpError {
  const code = err.code ?? "DB_ERROR";
  // DETAIL is only passed on when a SQL function wrote it on purpose (the wallet
  // shortfall is the one use); anywhere else it can name a constraint or a key.
  return new OpError(safeMessage(err), code, code === "P0001" ? (err.details ?? null) : null);
}

/** The data of a result, or its error in safe form. */
export function take<T = unknown>(res: DbResult, onError: (e: DbError) => OpError = toOpError): T {
  if (res.error) throw onError(res.error);
  return res.data as T;
}

/** The rows of a result (never null), or its error in safe form. */
export function rows<T = Record<string, unknown>>(res: DbResult, onError?: (e: DbError) => OpError): T[] {
  return (take<T[] | null>(res, onError) ?? []) as T[];
}

// -------------------------------------------------------------- validation --

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const bad = (field: string) => new OpError(`Invalid ${field}`, "BAD_ARGS");

export function uuid(a: Args, k: string): string {
  const v = a[k];
  if (typeof v !== "string" || !UUID.test(v)) throw bad(k);
  return v;
}

export function uuidOrNull(a: Args, k: string): string | null {
  return a[k] == null ? null : uuid(a, k);
}

export function uuids(a: Args, k: string, max = 500): string[] {
  const v = a[k] ?? [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== "string" || !UUID.test(x))) throw bad(k);
  return [...new Set(v as string[])];
}

export function str(a: Args, k: string, max: number, min = 1): string {
  const v = a[k];
  if (typeof v !== "string") throw bad(k);
  const t = v.trim();
  if (t.length < min || t.length > max) throw bad(k);
  return t;
}

/** Optional text: absent, null or blank becomes null. */
export function strOrNull(a: Args, k: string, max: number): string | null {
  const v = a[k];
  if (v == null) return null;
  if (typeof v !== "string") throw bad(k);
  const t = v.trim();
  if (!t) return null;
  if (t.length > max) throw bad(k);
  return t;
}

export function int(a: Args, k: string, min: number, max: number, dflt?: number): number {
  const v = a[k];
  if (v == null && dflt !== undefined) return dflt;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) throw bad(k);
  return v;
}

export function num(a: Args, k: string, min = -Infinity, max = Infinity): number {
  const v = a[k];
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max) throw bad(k);
  return v;
}

export function numOrNull(a: Args, k: string): number | null {
  const v = a[k];
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) throw bad(k);
  return v;
}

/** A latitude or longitude, or null: a number inside its real range. */
export function coordOrNull(a: Args, k: string, limit: number): number | null {
  const v = numOrNull(a, k);
  if (v !== null && Math.abs(v) > limit) throw bad(k);
  return v;
}

export function bool(a: Args, k: string, dflt = false): boolean {
  const v = a[k];
  if (v == null) return dflt;
  if (typeof v !== "boolean") throw bad(k);
  return v;
}

export function oneOf<T extends string>(a: Args, k: string, allowed: readonly T[], dflt?: T): T {
  const v = a[k];
  if (v == null && dflt !== undefined) return dflt;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) throw bad(k);
  return v as T;
}

export function strings(a: Args, k: string, maxItems = 50, maxLen = 100): string[] {
  const v = a[k] ?? [];
  if (!Array.isArray(v) || v.length > maxItems || v.some((s) => typeof s !== "string" || s.length > maxLen)) throw bad(k);
  return v as string[];
}

/** An ISO timestamp, or null. */
export function isoOrNull(a: Args, k: string): string | null {
  const v = a[k];
  if (v == null) return null;
  if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw bad(k);
  return v;
}

/**
 * A price for a task or an offer: a whole number of paise, at least the smallest amount (₹20).
 * Below that the answer says so in plain words, so the person can fix it.
 */
export function priceMinor(a: Args, k: string, min: number, max: number = MONEY_MAX): number {
  const v = int(a, k, 0, Number.MAX_SAFE_INTEGER);
  if (v < min) throw new OpError(`The smallest amount is ₹${min / 100}.`, "BAD_ARGS");
  if (v > max) throw new OpError(`The most is ₹${(max / 100).toLocaleString("en-IN")}.`, "BAD_ARGS");
  return v;
}

export const MONEY_MAX = 100_000_000_00; // sanity cap in minor units; the database holds the real limits
export const LIMIT_MAX = 200;

/** A page size, clamped rather than refused: a big ask is not an error. */
export function limit(a: Args, k = "limit", dflt = 30, max = LIMIT_MAX): number {
  const v = a[k];
  if (v == null) return dflt;
  if (typeof v !== "number" || !Number.isFinite(v)) throw bad(k);
  return Math.max(1, Math.min(max, Math.floor(v)));
}

// ----------------------------------------------------------------- helpers --

/**
 * Who a signed-in token belongs to, from the result of `auth.getClaims(jwt)`; null when the token did not check
 * out. getClaims verifies the signature here, against the project's cached public keys, so the sign-in check no
 * longer costs a round trip to the auth service on every call (it still asks the service itself when the project
 * signs with a shared secret). The anon key's token has no `sub`, so it never passes.
 */
export function callerFromClaims(res: { data: { claims?: { sub?: unknown } } | null; error: unknown } | null | undefined): string | null {
  if (!res || res.error) return null;
  const sub = res.data?.claims?.sub;
  return typeof sub === "string" && UUID.test(sub) ? sub : null;
}

/** An operation that is a single SQL function call. */
export function rpcOp(fn: string, build: (a: Args, ctx: Ctx) => Record<string, unknown> = () => ({})): Op {
  return async (ctx, a) => take(await ctx.db.rpc(fn, build(a, ctx)));
}

export const nowIso = (ctx: Ctx) => (ctx.now?.() ?? new Date()).toISOString();

/** PostgREST filter for tasks still takeable: no deadline, or a deadline still ahead. */
export const notExpired = (ctx: Ctx) => `due_at.is.null,due_at.gt.${nowIso(ctx)}`;

/**
 * Names that would pass for the team or the product. Found 2026-10-24: "admin", "support" and "taskdrop" were all
 * free to take. Saving one is refused (writes.ts) and usernameAvailable says it is taken (reads.ts, B69).
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  "admin", "administrator", "support", "help", "taskdrop", "task_drop", "team", "staff", "moderator", "mod", "official",
  "system", "root", "security", "billing", "payments", "payment", "wallet", "careers", "legal", "privacy", "terms",
]);

/** Group rows by a key into a plain object (Maps do not survive JSON). */
export function countBy<T>(list: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of list) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}

// ---------------------------------------------------------- account standing --

// The check itself lives in ../_shared/standing.ts so razorpay, razorpayx-payouts and places-search use the very
// same one (task 2.14, H46); it is re-exported here so the api's imports and tests are unchanged.
export { standingOf, type Standing, type StandingReader } from "../_shared/standing.ts";

// ------------------------------------------------------------ ended sessions --

/**
 * When a person's sessions were last ended (migration 142: sign out of all devices, a password change, an admin's
 * "sign out everywhere"), in whole seconds, and the one session that survived it. The token check above only reads a
 * signature, so without this an ended session's token would keep working until it expired (up to an hour).
 */
export interface SessionCutoff {
  revokedAtSec: number | null;
  keepSession: string | null;
}

/** Null when it could not be read: the caller lets the request go ahead and logs it, like standing. */
export async function cutoffOf(db: StandingReader, userId: string): Promise<SessionCutoff | null> {
  const { data, error } = await db.from("profiles").select("sessions_revoked_at, sessions_keep_session").eq("id", userId).maybeSingle();
  if (error) return null;
  const at = data?.sessions_revoked_at ? Date.parse(String(data.sessions_revoked_at)) : NaN;
  return {
    revokedAtSec: Number.isFinite(at) ? Math.floor(at / 1000) : null,
    keepSession: typeof data?.sessions_keep_session === "string" ? data.sessions_keep_session : null,
  };
}

/** What the signed token says about itself: when it was issued and which session it belongs to. */
export interface TokenFacts {
  iat: number | null;
  sessionId: string | null;
}

export function tokenFacts(res: { data: { claims?: { iat?: unknown; session_id?: unknown } } | null; error: unknown } | null | undefined): TokenFacts {
  const c = res && !res.error ? res.data?.claims : undefined;
  return {
    iat: typeof c?.iat === "number" ? c.iat : null,
    sessionId: typeof c?.session_id === "string" ? c.session_id : null,
  };
}

/** True when this token was issued before the person's sessions were ended, and is not the session they kept. */
export function endedBefore(cutoff: SessionCutoff | null, token: TokenFacts): boolean {
  if (!cutoff || cutoff.revokedAtSec === null) return false;
  if (token.sessionId !== null && token.sessionId === cutoff.keepSession) return false;
  // A real token always has an issue time; one without it cannot be shown to be newer than the cutoff.
  if (token.iat === null) return true;
  return token.iat < cutoff.revokedAtSec;
}

/**
 * Standing per person, kept in the function instance for a few seconds so a burst of calls (a screen opening) asks
 * once. Short on purpose: a suspension must bite within moments, not minutes. Unreadable answers are not kept.
 */
export class StandingCache<T = Standing> {
  private entries = new Map<string, { at: number; value: T }>();
  private inflight = new Map<string, Promise<T | null>>();

  constructor(private ttlMs: number, private now: () => number = Date.now) {}

  get(userId: string, load: () => Promise<T | null>): Promise<T | null> {
    const hit = this.entries.get(userId);
    if (hit && this.now() - hit.at < this.ttlMs) return Promise.resolve(hit.value);
    const pending = this.inflight.get(userId);
    if (pending) return pending;
    const p = load()
      .catch(() => null)
      .then((value) => {
        this.inflight.delete(userId);
        if (value) {
          // Same guard as ControlsCache: the memo must not grow without bound.
          if (this.entries.size >= 2000) this.entries.clear();
          this.entries.set(userId, { at: this.now(), value });
        }
        return value;
      });
    this.inflight.set(userId, p);
    return p;
  }
}
