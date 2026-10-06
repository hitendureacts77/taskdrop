/**
 * The operations the app may ask for, by name, and how one is run.
 *
 * The app sends `{ op: "placeBid", args: { ... } }` and gets back the result.
 * Which tables, columns, checks and calculations sit behind each name lives
 * here on the server, not in the bundle a customer downloads -- the same split
 * as a Spring Boot controller and the browser that calls it.
 *
 * Every operation runs as the signed-in caller (their own token), so row level
 * security and the SQL functions' own checks apply exactly as before.
 */

import { type Ctx, GENERIC, OpError, type Op } from "./core.ts";
import { MEDIA_OPS } from "./media.ts";
import { READ_OPS } from "./reads.ts";
import { WRITE_OPS } from "./writes.ts";

export { type Ctx, type Db, OpError, safeMessage } from "./core.ts";

export const OPS: Record<string, Op> = { ...READ_OPS, ...WRITE_OPS, ...MEDIA_OPS };

/**
 * Requests per person per minute, by kind. Generous for anyone using the app
 * by hand -- a busy screen makes a dozen reads -- and far below what a script
 * scraping the marketplace or hammering a money operation would need.
 */
export const RATE_LIMITS = { read: 300, write: 60, upload: 20 } as const;
export type RateBucket = keyof typeof RATE_LIMITS;

/** Which limit an operation counts against. Unknown names count as reads (they are refused anyway). */
export function rateBucket(name: unknown): RateBucket {
  if (name === "createUpload") return "upload";
  if (typeof name === "string" && Object.prototype.hasOwnProperty.call(WRITE_OPS, name)) return "write";
  if (name === "removeMedia") return "write";
  return "read";
}

export type Reply =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string; code: string; details: string | null } };

/** Run one operation. Anything that is not an `OpError` is hidden behind a generic message. */
export async function runOp(name: unknown, args: unknown, ctx: Ctx, onUnexpected: (e: unknown) => void = () => {}): Promise<Reply> {
  const op = typeof name === "string" && Object.prototype.hasOwnProperty.call(OPS, name) ? OPS[name] : undefined;
  if (!op) return { ok: false, error: { message: "Unknown request", code: "UNKNOWN_OP", details: null } };
  const a = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  try {
    return { ok: true, data: (await op(ctx, a)) ?? null };
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: { message: e.message, code: e.code, details: e.details } };
    onUnexpected(e);
    return { ok: false, error: { message: GENERIC, code: "INTERNAL", details: null } };
  }
}
