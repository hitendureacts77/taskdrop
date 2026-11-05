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
import { type Args, type Ctx, GENERIC, MONEY_MAX, OpError, type Op, bad, int, limit, num, oneOf, rows, str, strings, take, uuid, uuids } from "./core.ts";
import { MEDIA_OPS } from "./media.ts";
import { MAX_BATCH, type Reply, batchCalls } from "./ops.ts";
import { sharedAnswer } from "./publicMemo.ts";
import { READ_OPS } from "./reads.ts";

/** What a guest is told when they try something that needs an account. The app shows its own pop-up instead. */
export const NEEDS_ACCOUNT = "Make your account first.";
export const NEEDS_ACCOUNT_CODE = "NEEDS_ACCOUNT";

/** Guest reads per network address per minute: enough to browse by hand, far below scraping. */
export const GUEST_READS_PER_MINUTE = 120;

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
    limit: limit(a),
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
    posts(ctx, { kind: "service", limit: 500 }).catch(() => [] as Post[]),
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

  listOpenTasks: async (ctx, a) => (await posts(ctx, { kind: kindArg(a), limit: limit(a) })).map(bare),
  searchTasks: async (ctx, a) => (await search(ctx, a)).map(bare),
  searchTasksWithPosters: async (ctx, a) => (await search(ctx, a)).map((p) => ({ ...p, poster: p.poster ?? null })),

  attachPosters: async (ctx, a) => {
    const ids = uuids(a, "taskIds");
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
      posts(ctx, { kind: "request", poster: posterId, limit: 500 }),
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

  /** Pictures: only those on open posts and profile photos (guest_public_media), then signed as for anyone. */
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
export async function runGuestOp(name: unknown, args: unknown, ctx: Ctx, onUnexpected: (e: unknown) => void = () => {}): Promise<Reply> {
  if (!isGuestOp(name)) return needsAccount();
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
export async function runGuestBatch(args: unknown, ctx: Ctx, onUnexpected: (e: unknown) => void = () => {}): Promise<Reply> {
  const calls = batchCalls(args);
  if (!calls || calls.length > MAX_BATCH) return { ok: false, error: { message: "Invalid calls", code: "BAD_ARGS", details: null } };
  return { ok: true, data: await Promise.all(calls.map((c) => runGuestOp(c.op, c.args, ctx, onUnexpected))) };
}

/**
 * The limiter's key for a guest: their network address, hashed, shaped like the uuid the counter wants. The
 * address itself is never stored. Everyone with no known address shares one key.
 */
export async function guestRateKey(ip: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`guest|${ip || "unknown"}`)));
  const hex = [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
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
