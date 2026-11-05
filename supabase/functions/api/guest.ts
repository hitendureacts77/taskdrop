/**
 * Guest mode (design D15): what someone may read before they make an account.
 *
 * A guest has no session, so there is no token to run queries as. These
 * operations run with the service key instead, and so every one of them goes
 * through a SQL function from migration 146 (guest_open_posts, guest_profile,
 * guest_helpers, guest_reviews_about, guest_bid_counts, guest_public_media),
 * which decides what a guest may see: open posts only, no money or hiring
 * columns, places rounded to about a kilometre, public profile cards only. A few
 * public numbers (trending, highlights, top helpers, fees) reuse the
 * signed-in operation as it is, because the SQL behind them shows nothing
 * personal. Nothing here writes; every other name answers NEEDS_ACCOUNT, which
 * the app turns into the "Make your account" pop-up.
 *
 * The answers keep the shapes of the signed-in operations of the same name, so
 * the app's screens need no second code path.
 *
 * No Deno imports on purpose, so the tests run from Node.
 */

import { refusalFor } from "../_shared/controls.ts";
import { distanceKm } from "../_shared/rules.ts";
import { type Args, type Ctx, type Db, GENERIC, MONEY_MAX, OpError, type Op, bad, int, limit, num, oneOf, rows, rpcOp, str, strOrNull, strings, take, uuid, uuids } from "./core.ts";
import { MEDIA_OPS } from "./media.ts";
import { MAX_BATCH, type Reply, batchCalls } from "./ops.ts";
import { sharedAnswer } from "./publicMemo.ts";
import { READ_OPS } from "./reads.ts";

/** What a guest is told when they try something that needs an account. The app shows its own pop-up instead. */
export const NEEDS_ACCOUNT = "Make your account first.";
export const NEEDS_ACCOUNT_CODE = "NEEDS_ACCOUNT";

/**
 * The guest limiter (hunt round 2, H63 and H67), in cost units per minute. A light read costs 1, a heavy one more
 * (GUEST_COST). Counted by api_guest_spend (migration 154) per network address and for all guests together:
 *   * per address: enough to browse by hand on a shared mobile network, far below scraping;
 *   * all guests over the soft ceiling: only light reads run, heavy ones answer BUSY;
 *   * over the hard ceiling: nothing runs (503).
 * If the counter cannot be reached, a much smaller budget kept by this instance applies (GuestLocalLimit), with
 * light reads only: an outage of the limiter never opens the service key to everyone.
 */
export const GUEST_READS_PER_MINUTE = 240;
export const GUEST_ALL_SOFT_PER_MINUTE = 6_000;
export const GUEST_ALL_HARD_PER_MINUTE = 12_000;
/** The per-instance stand-in while the counter is down: per address, and for the whole instance. */
export const GUEST_LOCAL_PER_MINUTE = 60;
export const GUEST_LOCAL_ALL_PER_MINUTE = 600;

/** Most rows one guest list read may ask for, and how deep the Ideas board may be paged. */
export const GUEST_LIMIT_MAX = 100;
export const GUEST_MAX_OFFSET = 1_000;
/** Most task ids one guest attachPosters may carry (the app sends at most one search page, 200 at the very most). */
export const GUEST_MAX_IDS = 200;

/**
 * What a guest read costs against the limiter. Heavy reads pull hundreds of rows with the service key:
 * workersNear and listActiveWorkers read 300 profiles (plus 300 posts), getPosterStats up to 200 posts.
 * Anything not listed costs 1.
 */
export const GUEST_COST: Readonly<Record<string, number>> = {
  workersNear: 5,
  listActiveWorkers: 5,
  getPosterStats: 5,
  tasksNear: 3,
  searchTasks: 2,
  searchTasksWithPosters: 2,
  attachPosters: 2,
  recommendedTasks: 2,
  signMedia: 2,
};

const costOf = (name: unknown): number =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(GUEST_COST, name) ? GUEST_COST[name] : 1;

/** True for a read that is refused (BUSY) while all guests together are over the soft ceiling. */
export const isHeavyGuestOp = (name: unknown): boolean => costOf(name) > 1;

/**
 * What one guest request costs: its op's weight, or the sum over a batch's calls. A call a guest may not make costs
 * nothing (it is answered NEEDS_ACCOUNT without a query) and every request costs at least 1. At most 100, the most
 * the counter takes at once.
 */
export function guestCost(name: unknown, args: unknown): number {
  if (name !== "batch") return costOf(name);
  const calls = batchCalls(args);
  if (!calls) return 1;
  const sum = calls.reduce((n, c) => n + (isGuestOp(c.op) ? costOf(c.op) : 0), 0);
  return Math.max(1, Math.min(sum, 100));
}

/** What the limiter decided for a guest request. */
export type GuestVerdict = "ok" | "heavy_off" | "limited" | "busy";

/**
 * The limiter this instance keeps by itself, used only while api_guest_spend cannot be reached. Fixed one-minute
 * windows, a bounded map. Never says "ok": the best it gives is "heavy_off" (light reads only).
 */
export class GuestLocalLimit {
  private window = -1;
  private hits = new Map<string, number>();
  private all = 0;

  constructor(
    private perKey = GUEST_LOCAL_PER_MINUTE,
    private perInstance = GUEST_LOCAL_ALL_PER_MINUTE,
    private now: () => number = Date.now,
  ) {}

  spend(key: string, cost: number): GuestVerdict {
    const w = Math.floor(this.now() / 60_000);
    if (w !== this.window) {
      this.window = w;
      this.hits.clear();
      this.all = 0;
    }
    const mine = this.hits.get(key) ?? 0;
    if (mine + cost > this.perKey) return "limited";
    if (this.all + cost > this.perInstance) return "busy";
    // Too many addresses in one window: past this point everyone shares the instance budget only.
    if (this.hits.size < 5_000 || this.hits.has(key)) this.hits.set(key, mine + cost);
    this.all += cost;
    return "heavy_off";
  }
}

/**
 * Count one guest request (migration 154). If the counter errors, answers something unexpected or cannot be reached,
 * the instance's own small budget decides instead: bounded, never open. `onDown` hears why, for the log.
 */
export async function guestSpend(
  db: Db,
  key: string,
  cost: number,
  local: GuestLocalLimit,
  onDown: (why: string) => void = () => {},
): Promise<GuestVerdict> {
  try {
    const r = await db.rpc("api_guest_spend", {
      p_key: key, p_cost: cost, p_limit: GUEST_READS_PER_MINUTE,
      p_soft: GUEST_ALL_SOFT_PER_MINUTE, p_hard: GUEST_ALL_HARD_PER_MINUTE,
    });
    if (!r.error && (r.data === "ok" || r.data === "heavy_off" || r.data === "limited" || r.data === "busy")) return r.data;
    onDown(r.error ? r.error.message : "unexpected answer");
  } catch (e) {
    onDown(e instanceof Error ? e.message : String(e));
  }
  return local.spend(key, cost);
}

export const BUSY_CODE = "BUSY";
const busy = (): Reply => ({
  ok: false,
  error: { message: "Lots of people are looking right now. Please try again in a minute.", code: BUSY_CODE, details: null },
});

type Row = Record<string, unknown>;
type Post = Row & { id: string; poster_id: string; loc_lat: number | null; loc_lng: number | null; poster?: Row | null };

type PostFilter = {
  kind?: "request" | "service" | null;
  limit?: number;
  q?: string | null;
  pillar?: string | null;
  minMinor?: number | null;
  maxMinor?: number | null;
  flag?: string | null;
  pinned?: boolean | null;
  poster?: string | null;
  ids?: string[] | null;
};

/** Open posts through guest_open_posts. Each carries its poster's public card under `poster`. */
async function posts(ctx: Ctx, f: PostFilter): Promise<Post[]> {
  return rows<Post>(await ctx.db.rpc("guest_open_posts", {
    p_kind: f.kind === undefined ? "request" : f.kind,
    p_limit: f.limit ?? 30,
    p_q: f.q ?? null,
    p_pillar: f.pillar ?? null,
    p_min_minor: f.minMinor ?? null,
    p_max_minor: f.maxMinor ?? null,
    p_flag: f.flag ?? null,
    p_pinned: f.pinned ?? null,
    p_poster: f.poster ?? null,
    p_ids: f.ids ?? null,
  }));
}

/** A post as the plain task row the signed-in operation answers (no poster attached). */
const bare = ({ poster: _poster, ...task }: Post): Row => task;

const kindArg = (a: Args) => oneOf(a, "kind", ["request", "service"], "request");

/** Nearest first within a radius, each with its distance, like the signed-in map reads. */
function within<T extends { loc_lat: unknown; loc_lng: unknown }>(list: T[], at: { lat: number; lng: number }, radius: number) {
  return list
    .map((x) => ({ ...x, km: distanceKm(at, { lat: x.loc_lat as number | null, lng: x.loc_lng as number | null }) ?? Infinity }))
    .filter((x) => x.km <= radius)
    .sort((x, y) => x.km - y.km);
}

/** searchTasks' arguments, checked the same way. */
async function search(ctx: Ctx, a: Args): Promise<Post[]> {
  const nearArg = a.near as Args | null | undefined;
  if (nearArg != null && typeof nearArg !== "object") throw bad("near");
  const near = nearArg
    ? { lat: num(nearArg, "lat", -90, 90), lng: num(nearArg, "lng", -180, 180), radius: num(nearArg, "radiusKm", 0, 20000) }
    : null;
  const text = typeof a.q === "string" ? a.q.trim().slice(0, 200) : "";
  const found = await posts(ctx, {
    kind: kindArg(a),
    limit: limit(a, "limit", 30, GUEST_LIMIT_MAX),
    q: text || null,
    pillar: a.pillar != null ? str(a, "pillar", 40) : null,
    minMinor: typeof a.minMinor === "number" ? int(a, "minMinor", 0, MONEY_MAX) : null,
    maxMinor: typeof a.maxMinor === "number" ? int(a, "maxMinor", 0, MONEY_MAX) : null,
  });
  if (!near) return found;
  return found.filter((t) => {
    const km = distanceKm(near, { lat: t.loc_lat, lng: t.loc_lng });
    return km !== null && km <= near.radius;
  });
}

/** Helpers around a point with their newest open service, the shape workersNear answers. */
async function helpers(ctx: Ctx): Promise<(Row & { id: string; loc_lat: number; loc_lng: number; top_service: Row | null; service_count: number })[]> {
  const [people, services] = await Promise.all([
    ctx.db.rpc("guest_helpers", { p_limit: 300 }),
    posts(ctx, { kind: "service", limit: 300 }).catch(() => [] as Post[]),
  ]);
  const byPoster = new Map<string, Post[]>();
  for (const s of services) byPoster.set(s.poster_id, [...(byPoster.get(s.poster_id) ?? []), s]);
  return rows<Row & { id: string; loc_lat: number; loc_lng: number }>(people).map((p) => {
    const mine = byPoster.get(p.id) ?? [];
    const top = mine[0];
    return {
      ...p,
      top_service: top ? { id: top.id, title: top.title, price_minor: Number(top.benchmark_minor ?? 0), category: top.category ?? null } : null,
      service_count: mine.length,
    };
  });
}

/** Signed-in reads whose SQL shows only public numbers or public posts, reused as they are. */
const SHARED = [
  "trendingCategories", "platformHighlights", "topEarners", "platformFees", "publicProfileStats",
  "adAuctionRanks",
] as const;

export const GUEST_OPS: Record<string, Op> = {
  ...Object.fromEntries(SHARED.map((name) => [name, READ_OPS[name]])),

  listOpenTasks: async (ctx, a) => (await posts(ctx, { kind: kindArg(a), limit: limit(a, "limit", 30, GUEST_LIMIT_MAX) })).map(bare),
  searchTasks: async (ctx, a) => (await search(ctx, a)).map(bare),
  searchTasksWithPosters: async (ctx, a) => (await search(ctx, a)).map((p) => ({ ...p, poster: p.poster ?? null })),

  attachPosters: async (ctx, a) => {
    const ids = uuids(a, "taskIds", GUEST_MAX_IDS);
    if (ids.length === 0) return [];
    const found = new Map((await posts(ctx, { kind: null, ids, limit: ids.length })).map((p) => [p.id, p]));
    return ids.map((id) => found.get(id)).filter((p): p is Post => Boolean(p)).map((p) => ({ ...p, poster: p.poster ?? null }));
  },

  getTask: async (ctx, a) => {
    const [p] = await posts(ctx, { kind: null, ids: [uuid(a, "taskId")], limit: 1 });
    return p ? bare(p) : null;
  },

  /** The task page: the post and its poster. A guest never sees an address, a hold or a hired helper. */
  getTaskDetail: async (ctx, a) => {
    const [p] = await posts(ctx, { kind: null, ids: [uuid(a, "taskId")], limit: 1 });
    if (!p) return null;
    return { task: bare(p), address: null, assignment: null, poster: p.poster ?? null, worker: null };
  },

  countBidsByTask: async (ctx, a) => {
    const ids = uuids(a, "taskIds", 60);
    if (ids.length === 0) return {};
    return take<Record<string, number> | null>(await ctx.db.rpc("guest_bid_counts", { p_ids: ids })) ?? {};
  },

  getPosterStats: async (ctx, a) => {
    const posterId = uuid(a, "posterId");
    const [profile, open] = await Promise.all([
      ctx.db.rpc("guest_profile", { p_user: posterId }),
      posts(ctx, { kind: "request", poster: posterId, limit: 200 }),
    ]);
    return { profile: take(profile), requestsPosted: open.length };
  },

  recommendedTasks: async (ctx, a) => {
    const n = limit(a, "limit", 10, 60);
    const found = (await posts(ctx, { kind: "request", limit: 60 })).map(bare) as (Row & { title?: string; category?: string | null; skills?: string[] | null; description?: string })[];
    const needles = strings(a, "skills").map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()).filter(Boolean);
    if (needles.length === 0) return found.slice(0, n);
    const score = (t: (typeof found)[number]) => {
      const hay = [t.title ?? "", t.category ?? "", (t.skills ?? []).join(" "), t.description ?? ""].join(" ").toLowerCase().replace(/_/g, " ");
      return needles.reduce((sum, s) => sum + (hay.includes(s) ? 1 : 0), 0);
    };
    return found.map((t) => ({ t, s: score(t) })).sort((x, y) => y.s - x.s).map((x) => x.t).slice(0, n);
  },

  remoteTasks: async (ctx, a) => (await posts(ctx, { kind: "request", pinned: false, limit: limit(a, "limit", 5) })).map(bare),

  tasksNear: async (ctx, a) => {
    const at = { lat: num(a, "lat", -90, 90), lng: num(a, "lng", -180, 180) };
    const radius = num(a, "radiusKm", 0, 20000);
    const found = (await posts(ctx, { kind: "request", pinned: true, limit: 200 })).map(bare) as Post[];
    return within(found, at, radius).slice(0, limit(a, "limit", 5));
  },

  urgentTasks: async (ctx, a) => {
    const found = (await posts(ctx, { kind: "request", flag: "urgent", limit: 60 })).map(bare) as (Row & { due_at?: string | null })[];
    const due = (t: { due_at?: string | null }) => (t.due_at ? Date.parse(t.due_at) : Infinity);
    return found.sort((x, y) => due(x) - due(y)).slice(0, limit(a, "limit", 3));
  },

  workerServices: async (ctx, a) =>
    (await posts(ctx, { kind: "service", poster: uuid(a, "userId"), limit: limit(a, "limit", 10, 20) })).map(bare),

  workersNear: async (ctx, a) => {
    const at = { lat: num(a, "lat", -90, 90), lng: num(a, "lng", -180, 180) };
    const radius = num(a, "radiusKm", 0, 20000);
    return within(await helpers(ctx), at, radius).slice(0, limit(a, "limit", 12));
  },

  listActiveWorkers: async (ctx, a) => {
    const since = (ctx.now?.() ?? new Date()).getTime() - 30 * 60_000;
    const list = rows<Row & { last_seen_at: string | null; skills: string[] | null }>(await ctx.db.rpc("guest_helpers", { p_limit: 300 }));
    return list
      .filter((p) => (p.skills ?? []).length > 0 && p.last_seen_at && Date.parse(p.last_seen_at) > since)
      .slice(0, limit(a, "limit", 12));
  },

  getProfile: async (ctx, a) => take(await ctx.db.rpc("guest_profile", { p_user: uuid(a, "userId") })),

  listReviewsAbout: async (ctx, a) =>
    rows(await ctx.db.rpc("guest_reviews_about", {
      p_user: uuid(a, "userId"),
      p_role: oneOf(a, "role", ["admin", "poster", "worker"]),
      p_limit: limit(a, "limit", 10, 50),
    })),

  // Migration 151: the rest of what a signed-in stranger sees on these pages,
  // each through its guest_* function ("mine" and "iVoted" always false).

  /** Questions and answers on an open post. */
  listTaskQuestions: rpcOp("guest_task_questions", (a) => ({ p_task: uuid(a, "taskId") })),

  /** The public Ideas & feedback board. */
  listFeedbackBoard: rpcOp("guest_feedback_board_list", (a) => ({
    p_sort: oneOf(a, "sort", ["top", "new"], "top"),
    p_status: a.status == null ? null : oneOf(a, "status", ["open", "under_review", "planned", "in_progress", "done", "declined"]),
    p_category: a.category == null ? null : oneOf(a, "category", ["feature", "improvement", "bug", "other"]),
    p_search: strOrNull(a, "search", 60),
    p_limit: limit(a, "limit", 30, 50),
    p_offset: Math.min(int(a, "offset", 0, 10_000, 0), GUEST_MAX_OFFSET),
  })),

  /** One idea with its comments; null once it is hidden or gone. */
  getFeedbackPost: rpcOp("guest_feedback_board_get", (a) => ({ p_post: uuid(a, "postId") })),

  /** Two counts near a point: tasks finished today, helpers active now. */
  nearbyPulse: rpcOp("guest_nearby_pulse", (a) => ({
    p_lat: num(a, "lat", -90, 90),
    p_lng: num(a, "lng", -180, 180),
    p_radius_km: num(a, "radiusKm", 2, 25),
  })),

  /** A helper's before-and-after photos where the customer agreed. */
  workerProofPhotos: rpcOp("guest_proof_photos", (a) => ({ p_worker: uuid(a, "userId") })),

  /** Pictures: only those on open posts, profile photos and shared before/after photos (guest_public_media), then signed as for anyone. */
  signMedia: async (ctx, a) => {
    const raw = a.paths;
    if (!Array.isArray(raw) || raw.length > 200 || raw.some((p) => typeof p !== "string" || p.length > 300)) throw bad("paths");
    const asked = [...new Set(raw as string[])].filter(Boolean);
    if (asked.length === 0) return {};
    const allowed = take<string[] | null>(await ctx.db.rpc("guest_public_media", { p_paths: asked })) ?? [];
    if (allowed.length === 0) return {};
    return MEDIA_OPS.signMedia(ctx, { ...a, paths: allowed });
  },
};

/** True when a guest may ask for this by name. */
export const isGuestOp = (name: unknown): boolean =>
  typeof name === "string" && Object.prototype.hasOwnProperty.call(GUEST_OPS, name);

/** The answer to anything a guest may not do. */
export const needsAccount = (): Reply => ({ ok: false, error: { message: NEEDS_ACCOUNT, code: NEEDS_ACCOUNT_CODE, details: null } });

/** Run one guest operation: the admin panel's switches first, then the operation; anything else needs an account. */
export async function runGuestOp(
  name: unknown,
  args: unknown,
  ctx: Ctx,
  onUnexpected: (e: unknown) => void = () => {},
  lightOnly = false,
): Promise<Reply> {
  if (!isGuestOp(name)) return needsAccount();
  // All guests together are over the soft ceiling: the heavy reads wait, the light ones still answer.
  if (lightOnly && isHeavyGuestOp(name)) return busy();
  const a = args && typeof args === "object" && !Array.isArray(args) ? (args as Args) : {};
  const off = refusalFor(name, ctx.controls ?? null, a, {});
  if (off) return { ok: false, error: off };
  try {
    // The shared reads use the same memo as a signed-in caller: the key never says who asked (3.5b layer D).
    return { ok: true, data: (await sharedAnswer(name, a, ctx, () => GUEST_OPS[name as string](ctx, a))) ?? null };
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: { message: e.message, code: e.code, details: e.details } };
    onUnexpected(e);
    return { ok: false, error: { message: GENERIC, code: "INTERNAL", details: null } };
  }
}

/** A guest's batch of reads: each call alone, in order, like runBatch. */
export async function runGuestBatch(
  args: unknown,
  ctx: Ctx,
  onUnexpected: (e: unknown) => void = () => {},
  lightOnly = false,
): Promise<Reply> {
  const calls = batchCalls(args);
  if (!calls || calls.length > MAX_BATCH) return { ok: false, error: { message: "Invalid calls", code: "BAD_ARGS", details: null } };
  // batchCalls keeps only { op: string, args: object }: a batch inside a batch is just an op called "batch",
  // which is not a guest read and answers NEEDS_ACCOUNT.
  return { ok: true, data: await Promise.all(calls.map((c) => runGuestOp(c.op, c.args, ctx, onUnexpected, lightOnly))) };
}

/** A request that cannot run at all (all guests over the hard ceiling, or this instance's stand-in budget). */
export const guestBusy = busy;

/**
 * The limiter's key for a guest: their network address, hashed, shaped like the uuid the counter wants. The
 * address itself is never stored. Everyone with no known address shares one key.
 */
export async function guestRateKey(ip: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`guest|${guestRateScope(ip) || "unknown"}`)));
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * What one limiter key stands for. An IPv4 address as it is. An IPv6 address by its /64 (one home or phone line is
 * handed a whole /64, so counting each address alone would give one person billions of budgets); an IPv4 address
 * written the IPv6 way (::ffff:1.2.3.4) as the IPv4 address. Anything unreadable stays as sent.
 */
export function guestRateScope(ip: string): string {
  const s = ip.trim().toLowerCase().replace(/%.*$/, "");
  if (!s.includes(":")) return s;
  const mapped = s.match(/^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  const halves = s.split("::");
  if (halves.length > 2) return s;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  // A trailing dotted IPv4 part counts as two groups.
  if (tail.length && tail[tail.length - 1].includes(".")) tail.splice(tail.length - 1, 1, "0", "0");
  if (head.length && head[head.length - 1].includes(".")) head.splice(head.length - 1, 1, "0", "0");
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return s;
  const groups = [...head, ...Array(missing).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** The caller's address as the platform reports it (same rule as phone-auth: never true-client-ip or forwarded). */
export function guestAddress(headers: Headers): string {
  return (headers.get("cf-connecting-ip") ?? "").trim() || (headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
}

/** True when the token is the project's public key with no person behind it: a guest. */
export function isGuestToken(jwt: string, anonKey: string, claims: { data: { claims?: Record<string, unknown> } | null; error: unknown } | null): boolean {
  if (jwt && jwt === anonKey) return true;
  const c = claims && !claims.error ? claims.data?.claims : undefined;
  return Boolean(c && c.role === "anon" && !c.sub);
}
