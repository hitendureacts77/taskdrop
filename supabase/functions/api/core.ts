/**
 * Shared plumbing for the api function's operations: the context each one runs
 * in, safe error wording, and argument checks.
 *
 * No Deno imports on purpose, so everything under ./ can be exercised from Node.
 */

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

/** An operation that is a single SQL function call. */
export function rpcOp(fn: string, build: (a: Args, ctx: Ctx) => Record<string, unknown> = () => ({})): Op {
  return async (ctx, a) => take(await ctx.db.rpc(fn, build(a, ctx)));
}

export const nowIso = (ctx: Ctx) => (ctx.now?.() ?? new Date()).toISOString();

/** PostgREST filter for tasks still takeable: no deadline, or a deadline still ahead. */
export const notExpired = (ctx: Ctx) => `due_at.is.null,due_at.gt.${nowIso(ctx)}`;

/** Group rows by a key into a plain object (Maps do not survive JSON). */
export function countBy<T>(list: T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of list) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}
