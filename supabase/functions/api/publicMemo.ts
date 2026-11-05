/**
 * The server's shared answers (plan task 3.5b, layer D): the closed list of
 * reads whose answer is the same for everyone who asks, and how long one
 * answer may be handed out again inside one server copy.
 *
 * Each op here was checked to return the same bytes for any caller: its SQL is
 * `security definer` with no `auth.uid()` (trending_categories, top_earners,
 * platform_highlights, ad_auction), or it reads `settings` rows every signed-in
 * person may read (promotionTiers). Anything whose answer depends on who is
 * asking (row rules, blocked people, the caller's own rows) must never be here:
 * `contract.test.ts` fails if a money, task, offer, chat, contact or admin op,
 * or anything in the app's `NEVER_REUSE`, is added.
 *
 * Only the list and pure helpers for now; the memo itself comes later.
 * No Deno imports on purpose, so this can be tested from Node.
 */

/** Shortest and longest time a shared answer may be kept. */
export const MEMO_MIN_TTL_MS = 15_000;
export const MEMO_MAX_TTL_MS = 60_000;

/** Most answers one server copy keeps at once. */
export const MEMO_MAX_ENTRIES = 500;

/** Op name -> how long its answer may be shared, in milliseconds. */
export const PUBLIC_MEMO_OPS = Object.freeze({
  trendingCategories: 60_000,
  topEarners: 60_000,
  platformHighlights: 30_000,
  promotionTiers: 60_000,
  adAuctionRanks: 15_000,
} as const satisfies Record<string, number>);

export type PublicMemoOp = keyof typeof PUBLIC_MEMO_OPS;

/** True when this op's answer may be shared between callers. */
export function isPublicMemoOp(name: unknown): name is PublicMemoOp {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(PUBLIC_MEMO_OPS, name);
}

/** How long this op's answer may be shared; null when it may not be shared at all. */
export function memoTtlMs(name: unknown): number | null {
  return isPublicMemoOp(name) ? PUBLIC_MEMO_OPS[name] : null;
}

/** JSON with object keys sorted at every depth, so the same arguments always give the same text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stable(x))).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * The memo key: `op:sorted args`. Built from the op and its arguments only, never
 * from who is asking, so it is only ever used for ops on the shared list.
 */
export function memoKey(op: PublicMemoOp, args: Record<string, unknown> | null | undefined): string {
  return `${op}:${stable(args ?? {})}`;
}
