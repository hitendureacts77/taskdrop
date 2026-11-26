import { FEES, TIMING, distanceKm } from "../_shared/rules.ts";

/** Most rows one "my" list returns. Said here so a long list is cut on purpose, not by the database's own row cap (S1-21). */
const MY_LIST_MAX = 500;
import {
  type Args, type CatalogFn, type Ctx, type DbResult, type Op, GENERIC, MONEY_MAX, OpError, RESERVED_USERNAMES, bad, countBy, int, isoOrNull, limit, nowIso, num, coordOrNull, oneOf, rows,
  rpcOp, str, strOrNull, strings, take, uuid, uuids,
} from "./core.ts";
import { noKeep } from "./publicMemo.ts";
import { chatStateFrom, readChatStates } from "./chat.ts";
import { type Understanding, nearConcepts, rankedSearch, suggestConcepts, understand, whyLine } from "./search.ts";
import { findContactIssue } from "../_shared/contacts.ts";
import { embedText, toVectorLiteral } from "../_shared/meaning.ts";
import {
  ASSIGNMENT_SELECT, BID_SELECT, CREW_MESSAGE_SELECT, MESSAGE_SELECT, PROFILE_OWNER_SELECT, PROFILE_PUBLIC_SELECT, PROOF_SELECT,
  NOTIFICATION_SELECT, PAYMENT_SELECT, PAYOUT_DESTINATION_SELECT, PAYOUT_SELECT, PROMOTION_SELECT, REVIEW_SELECT,
  SUPPORT_MESSAGE_SELECT, SUPPORT_TICKET_SELECT, WALLET_SELECT, TASKS_PARTY_EMBED, TASKS_PUBLIC_EMBED, TASK_PARTY_SELECT, TASK_PUBLIC_SELECT, redactTask,
} from "./columns.ts";

/**
 * Everything the app reads. "My" queries always say whose rows they mean, using
 * the caller's id from their session: an admin's policies match every row, so
 * a query that leaned on row level security alone would silently turn into
 * "everybody's rows" for a staff account.
 */

type Row = Record<string, unknown>;
type Task = Row & { id: string; poster_id: string; status: string; loc_lat: number | null; loc_lng: number | null };

/**
 * Task rows that may belong to someone else, with the money and hiring fields kept only on the ones the caller is a
 * party to (task 2.18 A): their own posts, and tasks they are hired on. `hired` is the set of task ids the caller
 * already knows they are hired on; without it, one lookup is made, and only when a row that is not the caller's own
 * is past OPEN (an assignment exists only after the offer is accepted).
 */
async function forCaller<T extends Task>(ctx: Ctx, list: T[], hired?: Set<string>): Promise<T[]> {
  const others = list.filter((t) => t.poster_id !== ctx.userId);
  if (others.length === 0) return list;
  let mine = hired ?? new Set<string>();
  if (!hired && others.some((t) => t.status !== "OPEN")) {
    const res = await ctx.db.from("assignments").select("task_id").in("task_id", others.map((t) => t.id)).eq("worker_id", ctx.userId);
    mine = new Set(rows<{ task_id: string }>(res).map((r) => r.task_id));
  }
  return list.map((t) => (t.poster_id === ctx.userId || mine.has(t.id) ? t : redactTask(t)));
}

/** Profiles for a set of ids, keyed by id. Public fields only: the private ones are never in an answer about a person. */
async function profilesById(ctx: Ctx, ids: (string | null | undefined)[]): Promise<Map<string, Row>> {
  const want = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (want.length === 0) return new Map();
  const people = rows<Row & { id: string }>(await ctx.db.from("profiles").select(PROFILE_PUBLIC_SELECT).in("id", want));
  return new Map(people.map((p) => [p.id, p]));
}

/**
 * Open posts of one kind that the caller could take on (never their own). A City Hunt that has stopped taking finds
 * (hunt_until passed) stays OPEN while its poster reviews, but nobody can act on it any more, so it is left out (B86).
 * A task whose date has passed stays: it is open until someone is picked, and the server switches it to no fixed
 * date within 15 minutes (plan 1.19 J, migration 216).
 */
function openTasksQuery(ctx: Ctx, kind: "request" | "service") {
  return ctx.db
    .from("tasks")
    .select(TASK_PUBLIC_SELECT)
    .eq("status", "OPEN")
    .or(`hunt_until.is.null,hunt_until.gt.${nowIso(ctx)}`)
    .eq("kind", kind)
    .neq("poster_id", ctx.userId);
}

/** The two kinds of catalog term. */
export const catalogKind = (a: Args) => oneOf(a, "kind", ["skill", "category"]);

/** What a refused word is told, in words a person can act on. */
export function catalogRefusalMessage(kind: string, reason: unknown): string {
  const thing = kind === "category" ? "category" : "skill";
  switch (reason) {
    case "length": return "Keep it between 2 and 30 letters.";
    case "letters": return `Type the ${thing} in English letters.`;
    case "contact":
    case "rude": return `A ${thing} can't have a phone number, email, link or rude words. Type just the ${thing}.`;
    case "hidden": return "That one can't be used. Pick another.";
    default: return "That one can't be used. Pick another.";
  }
}

/** Adds the `message` to a refused answer; any other answer passes through. */
export function catalogRefusal(kind: string, res: unknown): unknown {
  if (res && typeof res === "object" && (res as { result?: unknown }).result === "refused") {
    return { ...(res as object), message: catalogRefusalMessage(kind, (res as { reason?: unknown }).reason) };
  }
  return res;
}

/** A phone number, email or link is refused here, before the database or the model is asked. */
export function catalogContactRefusal(kind: string, text: string): { result: "refused"; reason: "contact"; message: string } | null {
  if (!findContactIssue(text)) return null;
  return { result: "refused", reason: "contact", message: catalogRefusalMessage(kind, "contact") };
}

/**
 * The arguments for catalog_check_for / catalog_add_for. The meaning vector is always worked out here, never taken
 * from the app (migration 228); null when the model is not available. The threshold lives in the database
 * (private.catalog_settings.min_meaning) and the caller's id is added by `ctx.catalogRpc`.
 */
export async function catalogArgs(kind: string, text: string): Promise<Record<string, unknown>> {
  const v = await embedText(text);
  return { p_kind: kind, p_text: text, p_embedding: v ? toVectorLiteral(v) : null };
}

/** Calls a service-role catalog function for the caller, or refuses when the server has no service key. */
export function catalogCall(ctx: Ctx, fn: CatalogFn, args: Record<string, unknown>): PromiseLike<DbResult> {
  if (!ctx.catalogRpc) throw new OpError(GENERIC, "INTERNAL");
  return ctx.catalogRpc(fn, args);
}

const kindArg = (a: Args) => oneOf(a, "kind", ["request", "service"], "request");

export type NearBox = { minLat: number; maxLat: number; minLng: number | null; maxLng: number | null };

/**
 * A latitude/longitude box that holds every spot within `radius` km of `at`, for narrowing a distance read in SQL
 * before the exact distance is worked out (B34: capping the newest rows first, then filtering by distance, dropped
 * nearby posts). Slightly wider than the circle, never narrower: 111 km a degree (the exact figure is 111.2), and the
 * longitude span is taken at the box edge farthest from the equator. The longitude bound is left off (null) where it
 * would wrap past 180 degrees or reach a pole; past 2,000 km there is no box at all (null).
 */
export function nearBox(at: { lat: number; lng: number }, radius: number): NearBox | null {
  if (!(radius >= 0) || radius > 2000) return null;
  const dLat = radius / 111;
  const minLat = Math.max(-90, at.lat - dLat);
  const maxLat = Math.min(90, at.lat + dLat);
  const edge = Math.max(Math.abs(minLat), Math.abs(maxLat));
  if (edge >= 89) return { minLat, maxLat, minLng: null, maxLng: null };
  const dLng = radius / (111 * Math.cos((edge * Math.PI) / 180));
  if (at.lng - dLng < -180 || at.lng + dLng > 180) return { minLat, maxLat, minLng: null, maxLng: null };
  return { minLat, maxLat, minLng: at.lng - dLng, maxLng: at.lng + dLng };
}

/** `q` narrowed to the box (PostgREST gte/lte on loc_lat and loc_lng); unchanged when there is no box. */
function inBox<Q extends { gte(c: string, v: number): Q; lte(c: string, v: number): Q }>(q: Q, box: NearBox | null): Q {
  if (!box) return q;
  const out = q.gte("loc_lat", box.minLat).lte("loc_lat", box.maxLat);
  return box.minLng !== null && box.maxLng !== null ? out.gte("loc_lng", box.minLng).lte("loc_lng", box.maxLng) : out;
}

/** How many rows a radius search reads inside its box before the exact distance cut, for a page of `n`. */
export const nearFetch = (n: number) => Math.min(500, Math.max(n * 3, 200));

export type Near = { lat: number; lng: number; radius: number };

/** The optional `near` argument, `{ lat, lng, radiusKm }`, checked before anything is asked of the database; null when absent. */
export function nearArgOf(a: Args): Near | null {
  const nearArg = a.near as Args | null | undefined;
  if (nearArg != null && typeof nearArg !== "object") throw bad("near");
  return nearArg
    ? { lat: num(nearArg, "lat", -90, 90), lng: num(nearArg, "lng", -180, 180), radius: num(nearArg, "radiusKm", 0, 20000) }
    : null;
}

/**
 * Whether a task is in reach of a worker at `near` (B156): a remote task (no pin) can be done from anywhere, an
 * in-person one only within the radius.
 */
export const inReach = (near: Near) => (t: { loc_lat: unknown; loc_lng: unknown }): boolean => {
  if (t.loc_lat == null) return true;
  const km = distanceKm(near, { lat: t.loc_lat as number | null, lng: t.loc_lng as number | null });
  return km !== null && km <= near.radius;
};

/**
 * Open requests in reach of `near` (B156): pinned ones read inside the box around it (in SQL, before the cap, B34)
 * and kept only within the radius, and remote ones from anywhere. `read` adds the list's own filter, order and cap
 * to each of the two reads; the caller orders the merged list.
 */
async function requestsInReach(
  ctx: Ctx,
  near: Near,
  read: (q: ReturnType<typeof openTasksQuery>) => PromiseLike<DbResult>,
): Promise<Task[]> {
  const [pinned, remote] = await Promise.all([
    read(inBox(openTasksQuery(ctx, "request").not("loc_lat", "is", null), nearBox(near, near.radius))),
    read(openTasksQuery(ctx, "request").is("loc_lat", null)),
  ]);
  return [...rows<Task>(pinned).filter(inReach(near)), ...rows<Task>(remote)];
}

/** Newest first, by `created_at`. */
export const newestFirst = (x: { created_at?: unknown }, y: { created_at?: unknown }) =>
  String(y.created_at ?? "").localeCompare(String(x.created_at ?? ""));

/** Soonest due first, undated last (the urgent list's order). */
export const soonestDue = (x: { due_at?: unknown }, y: { due_at?: unknown }) => {
  const due = (t: { due_at?: unknown }) => (typeof t.due_at === "string" ? Date.parse(t.due_at) : Infinity);
  return due(x) - due(y);
};

/** A task still holding money: chosen and paid for, but not yet finished. */
const IN_PROGRESS = new Set(["LOCKED", "TASK_STARTED", "OVERDUE", "WORK_DONE", "REVISION_REQUESTED", "DISPUTED"]);

type LiveFees = { commission: number; posterFee: number; clearingDays: number; cancelFine: number };

/**
 * The fee settings as they are now (the admin can change them), with the
 * built-in rules as the fallback when a key is missing or unreadable.
 */
/**
 * Plan B (migration 195): true when pay-per-task is on. There is no wallet then, so the wallet checks for
 * auto-hire are skipped: the poster pays each hire at the payment company. An unreadable answer counts as the
 * wallet flow (the older, stricter check).
 */
export async function planBOn(ctx: Ctx): Promise<boolean> {
  const res = await ctx.db.rpc("my_money_mode");
  const flow = (res.data as { flow?: unknown } | null)?.flow;
  return !res.error && flow === "plan_b";
}

export async function readFees(ctx: Ctx): Promise<LiveFees> {
  const res = await ctx.db.from("settings").select("key,value")
    .in("key", ["worker_commission_pct", "poster_service_fee_pct", "clearing_period_days", "post_start_cancel_penalty_pct"]);
  const list = (res.data ?? []) as { key: string; value: unknown }[];
  // A missing, empty or out-of-range value is "unreadable": the built-in rule is used, not 0%.
  const get = (k: string, d: number, max = 1) => {
    const raw = list.find((r) => r.key === k)?.value;
    if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return d;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 && v < max ? v : d;
  };
  return {
    commission: get("worker_commission_pct", FEES.WORKER_COMMISSION_PCT),
    posterFee: get("poster_service_fee_pct", FEES.POSTER_SERVICE_FEE_PCT),
    clearingDays: get("clearing_period_days", TIMING.CLEARING_PERIOD_DAYS, 366),
    // The Terms point at How fees work for this one too.
    cancelFine: get("post_start_cancel_penalty_pct", FEES.POST_START_CANCEL_PENALTY_PCT),
  };
}

/** Paise as plain rupees for a wallet line: 2500 -> "25", 2550 -> "25.50". */
const rupeesText = (minor: number) => (minor % 100 === 0 ? String(minor / 100) : (minor / 100).toFixed(2));

/** What reaches a worker from an escrow: the price (escrow less the poster's fee), less commission. */
const workerShareOfEscrow = (escrowMinor: number, fees: LiveFees) =>
  Math.round(Math.round(escrowMinor / (1 + fees.posterFee)) * (1 - fees.commission));

/** `drop`: the chip ids the searcher took off (smart search). */
const dropArg = (a: Args): string[] =>
  Array.isArray(a.drop) ? a.drop.filter((x): x is string => typeof x === "string" && /^[a-z]{2,20}$/.test(x)).slice(0, 10) : [];

/**
 * Ranked rows, best first. With a point: only those within the exact radius, and a small nudge for being closer
 * (up to half the weight of the freshness part), so two equally good matches show the nearer one first.
 */
export function orderRanked<T extends { id: string; loc_lat: unknown; loc_lng: unknown; title?: unknown; description?: unknown; category?: unknown }>(
  found: T[],
  ranked: { ids: { id: string; score: number }[]; u: Understanding },
  near: Near | null,
): (T & { match_why: string | null })[] {
  const score = new Map(ranked.ids.map((r) => [r.id, r.score]));
  return found
    .map((t) => {
      let s = score.get(t.id) ?? 0;
      if (near) {
        const km = distanceKm(near, { lat: t.loc_lat as number | null, lng: t.loc_lng as number | null });
        if (km === null || km > near.radius) return null;
        s += 0.05 * (1 - km / Math.max(near.radius, 0.1));
      }
      return { t: { ...t, match_why: whyLine(t, ranked.u) }, s };
    })
    .filter((x): x is { t: T & { match_why: string | null }; s: number } => x !== null)
    .sort((x, y) => y.s - x.s)
    .map((x) => x.t);
}

/** The rows for ranked ids, read the way the caller may see them (members: row level security; guests: guest_open_posts). */
export type RowsFor = (ctx: Ctx, kind: "request" | "service", ids: string[]) => Promise<Task[]>;
const memberRows: RowsFor = async (ctx, kind, ids) => rows<Task>(await openTasksQuery(ctx, kind).in("id", ids));

/**
 * The two smart search hint reads, for members and guests alike: `rowsFor` decides what the caller may see, `viewer`
 * leaves the caller's own posts out. Every count uses the same ranked search as the list.
 */
export function searchHintOps(rowsFor: RowsFor, viewer: (ctx: Ctx) => string | null): Record<"searchSuggest" | "searchFallbacks", Op> {
  /** How many open posts a search finds (within the radius when `near` is given). */
  const countFor = async (ctx: Ctx, kind: "request" | "service", text: string, near: Near | null): Promise<number> => {
    const ranked = await rankedSearch(ctx.db as never, { kind, text, viewer: viewer(ctx), box: near ? nearBox(near, near.radius) : null, limit: 200 });
    if (!ranked || ranked.ids.length === 0) return 0;
    const list = await rowsFor(ctx, kind, ranked.ids.map((r) => r.id));
    return near ? orderRanked(list, ranked, near).length : list.length;
  };
  /** How many remote posts (no pin) a search finds anywhere. */
  const remoteCount = async (ctx: Ctx, kind: "request" | "service", text: string): Promise<number> => {
    const ranked = await rankedSearch(ctx.db as never, { kind, text, viewer: viewer(ctx), limit: 200 });
    if (!ranked || ranked.ids.length === 0) return 0;
    return (await rowsFor(ctx, kind, ranked.ids.map((r) => r.id))).filter((t) => t.loc_lat == null).length;
  };
  return {
    /**
     * "Looks like you mean" while typing, and the chips once searched: the kinds of work a search points to, each
     * with how many open posts match it (within the area when `near` is given), plus the spelling fix if one was made.
     * `counts: false` skips the counts, for every keystroke.
     */
    searchSuggest: async (ctx, a) => {
      const near = nearArgOf(a);
      const text = typeof a.q === "string" ? a.q.trim().slice(0, 200) : "";
      const kind = kindArg(a);
      const u = understand(text, { drop: dropArg(a), exact: a.exact === true });
      const found = suggestConcepts(text);
      const suggestions = a.counts === false
        ? found.map((c) => ({ id: c.id, label: c.label, count: null }))
        : await Promise.all(found.map(async (c) => ({ id: c.id, label: c.label, count: await countFor(ctx, kind, c.says[0], near) })));
      return { corrected: u.corrected, chips: u.chips, suggestions };
    },
    /** Next steps when a search finds nothing: how many within 25 km, how many remote, close kinds of work. */
    searchFallbacks: async (ctx, a) => {
      const near = nearArgOf(a);
      const text = typeof a.q === "string" ? a.q.trim().slice(0, 200) : "";
      if (!text) return { wider: null, remote: 0, related: null };
      const kind = kindArg(a);
      const u = understand(text, { drop: dropArg(a) });
      const wideKm = 25;
      const close = nearConcepts(u.chips);
      const [wider, remote, relatedCounts] = await Promise.all([
        near && near.radius < wideKm
          ? countFor(ctx, kind, text, { ...near, radius: wideKm }).then((count) => ({ km: wideKm, count }))
          : Promise.resolve(null),
        remoteCount(ctx, kind, text),
        Promise.all(close.map((c) => countFor(ctx, kind, c.says[0], near))),
      ]);
      const related = close.length
        ? { labels: close.map((c) => c.label), q: close.map((c) => c.says[0]).join(" "), count: relatedCounts.reduce((x, y) => x + y, 0) }
        : null;
      return { wider, remote, related };
    },
  };
}

export const READ_OPS: Record<string, Op> = {
  // ------------------------------------------------------------- tasks ----
  listOpenTasks: async (ctx, a) =>
    rows(await openTasksQuery(ctx, kindArg(a)).order("created_at", { ascending: false }).limit(limit(a))),

  listMyTasks: async (ctx, a) =>
    rows(
      await ctx.db.from("tasks").select(TASK_PARTY_SELECT).eq("poster_id", ctx.userId).eq("kind", kindArg(a))
        .order("created_at", { ascending: false }).limit(MY_LIST_MAX),
    ),

  listMyBids: async (ctx) => {
    const list = rows<Row & { id: string; tasks: Task | null }>(
      await ctx.db.from("bids").select(`${BID_SELECT}, ${TASKS_PARTY_EMBED}`).eq("worker_id", ctx.userId)
        .order("created_at", { ascending: false }).limit(MY_LIST_MAX),
    );
    // Only an accepted offer makes the bidder a party to the task; for the rest the money fields are dropped.
    return list.map((b) => ({
      ...b,
      tasks: b.tasks && b.tasks.poster_id !== ctx.userId && b.tasks.locked_bid_id !== b.id ? redactTask(b.tasks) : b.tasks,
    }));
  },

  listMyAssignments: async (ctx) =>
    rows(
      await ctx.db.from("assignments").select(`${ASSIGNMENT_SELECT}, ${TASKS_PARTY_EMBED}`).eq("worker_id", ctx.userId)
        .order("created_at", { ascending: false }).limit(MY_LIST_MAX),
    ),

  /** Incoming quotes on a task, cheapest first, each with the worker's profile. */
  listBidsForTask: async (ctx, a) => {
    const bids = rows<Row & { worker_id: string }>(
      await ctx.db.from("bids").select(BID_SELECT).eq("task_id", uuid(a, "taskId")).order("price_minor"),
    );
    const people = await profilesById(ctx, bids.map((b) => b.worker_id));
    return bids.map((b) => ({ ...b, profiles: people.get(b.worker_id) ?? null }));
  },

  /** How many quotes each of these tasks has: { [taskId]: count }. */
  countBidsByTask: async (ctx, a) => {
    const ids = uuids(a, "taskIds");
    if (ids.length === 0) return {};
    const list = rows<{ task_id: string }>(await ctx.db.from("bids").select("task_id").in("task_id", ids));
    return countBy(list, (r) => r.task_id);
  },

  /** Which of these tasks the caller has already sent an offer on (one offer per task). */
  myBidTaskIds: async (ctx, a) => {
    const ids = uuids(a, "taskIds", 100);
    if (ids.length === 0) return [];
    return rows<{ task_id: string }>(await ctx.db.from("bids").select("task_id").eq("worker_id", ctx.userId).in("task_id", ids))
      .map((r) => r.task_id);
  },

  /**
   * Open tasks matching the search screen's filters. Every filter is optional. With words (`q`), the posts are the
   * ones that match what was meant, best first (smart search, migration 223, ./search.ts); each carries `match_why`,
   * the short line saying why it came up. `drop` takes chips off, `exact: true` keeps the spelling as typed.
   */
  searchTasks: async (ctx, a) => {
    // Checked before anything is asked of the database.
    const near = nearArgOf(a);
    const text = typeof a.q === "string" ? a.q.trim().slice(0, 200) : "";
    const n = limit(a);
    const pillar = a.pillar != null ? str(a, "pillar", 40) : null;
    const minMinor = typeof a.minMinor === "number" ? int(a, "minMinor", 0, MONEY_MAX) : null;
    const maxMinor = typeof a.maxMinor === "number" ? int(a, "maxMinor", 0, MONEY_MAX) : null;

    if (text) {
      const ranked = await rankedSearch(ctx.db as never, {
        kind: kindArg(a), text, drop: dropArg(a), exact: a.exact === true, viewer: ctx.userId, pillar, minMinor, maxMinor,
        box: near ? nearBox(near, near.radius) : null, limit: near ? nearFetch(n) : Math.max(n, 60),
      });
      if (ranked) {
        ctx.searchFill?.();
        if (ranked.ids.length === 0) return [];
        // Read through row level security, so hidden and blocked posts stay out exactly as before.
        const found = rows<Task>(await openTasksQuery(ctx, kindArg(a)).in("id", ranked.ids.map((r) => r.id)));
        return orderRanked(found, ranked, near).slice(0, n);
      }
      // search_posts is not in the database yet: the old word match below.
    }

    let q = openTasksQuery(ctx, kindArg(a));
    if (text) {
      // Commas and parens would break out of PostgREST's or() filter grammar.
      const safe = text.replace(/[,()*%\\]/g, " ").trim();
      if (safe) q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
    }
    if (pillar != null) q = q.eq("pillar", pillar);
    if (minMinor != null) q = q.gte("benchmark_minor", minMinor);
    if (maxMinor != null) q = q.lte("benchmark_minor", maxMinor);
    if (!near) return rows<Task>(await q.order("created_at", { ascending: false }).limit(n));

    // With a point, SQL first narrows to a box around it and reads more than a page (B34: capping first and
    // filtering after dropped nearby tasks behind newer far-away ones). The exact distance is then checked here,
    // newest first as before, and only then is the page cut. A task with no pin cannot be shown to be within any
    // radius, so it is not.
    const found = rows<Task>(await inBox(q, nearBox(near, near.radius)).order("created_at", { ascending: false }).limit(nearFetch(n)));
    return found.filter((t) => {
      const km = distanceKm(near, { lat: t.loc_lat, lng: t.loc_lng });
      return km !== null && km <= near.radius;
    }).slice(0, n);
  },

  ...searchHintOps(memberRows, (ctx) => ctx.userId),

  /** Attach each task's poster profile, for feed rows that show identity. */
  attachPosters: async (ctx, a) => {
    const ids = uuids(a, "taskIds");
    if (ids.length === 0) return [];
    const tasks = await forCaller(ctx, rows<Task>(await ctx.db.from("tasks").select(TASK_PARTY_SELECT).in("id", ids)));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const people = await profilesById(ctx, tasks.map((t) => t.poster_id));
    // Same order the caller asked in; anything no longer visible drops out.
    return ids
      .map((id) => byId.get(id))
      .filter((t): t is Task => Boolean(t))
      .map((t) => ({ ...t, poster: people.get(t.poster_id) ?? null }));
  },

  /**
   * searchTasks with each task's poster attached: what attachPosters(searchTasks(...)) answers, in one request
   * instead of two back to back. Same filters and arguments as searchTasks. Explore waited 13 s on that pair on
   * a busy moment (2026-10-29): each request paid its own sign-in check and queue on the server.
   */
  searchTasksWithPosters: async (ctx, a) => {
    const found = (await READ_OPS.searchTasks(ctx, a)) as Task[];
    if (found.length === 0) return [];
    const people = await profilesById(ctx, found.map((t) => t.poster_id));
    return found.map((t) => ({ ...t, poster: people.get(t.poster_id) ?? null }));
  },

  getTask: async (ctx, a) => {
    const taskId = uuid(a, "taskId");
    // The hired-worker check runs beside the read, so a worker's page waits no longer for it.
    const [taskRes, hiredRes] = await Promise.all([
      ctx.db.from("tasks").select(TASK_PARTY_SELECT).eq("id", taskId).maybeSingle(),
      ctx.db.from("assignments").select("task_id").eq("task_id", taskId).eq("worker_id", ctx.userId).limit(1),
    ]);
    const task = take<Task | null>(taskRes);
    if (!task) return null;
    return (await forCaller(ctx, [task], new Set(rows<{ task_id: string }>(hiredRes).map((r) => r.task_id))))[0];
  },

  /** The task, the assignment holding its escrow, and both people, in one round trip. */
  getTaskDetail: async (ctx, a) => {
    const taskId = uuid(a, "taskId");
    // The task, its holds and its typed address do not depend on each other: ask for all three at once
    // (this answer is what a job screen waits on, so each round trip saved is a shorter grey wait, B11).
    const [taskRes, assignmentsRes, privateRow] = await Promise.all([
      ctx.db.from("tasks").select(TASK_PARTY_SELECT).eq("id", taskId).maybeSingle(),
      ctx.db.from("assignments").select(ASSIGNMENT_SELECT).eq("task_id", taskId).order("created_at", { ascending: false }),
      // The typed address (migration 126): row-level security lets only the poster, the hired worker and staff read it.
      // A failed read (migration not applied yet) is just "no address", never a failed task page.
      ctx.db.from("task_private").select("address").eq("task_id", taskId).maybeSingle(),
    ]);
    const taskRow = take<Task | null>(taskRes);
    if (!taskRow) return null;
    const list = rows<Row & { status: string; worker_id: string }>(assignmentsRes);
    // The poster and the hired worker see the money fields; anyone else who can read the task does not.
    const hired = new Set(list.filter((x) => x.worker_id === ctx.userId).map(() => taskRow.id));
    const task = (await forCaller(ctx, [taskRow], hired))[0];
    // A task can carry stale holds from workers who lost the race to start.
    const assignment = list.find((x) => x.status === "started" || x.status === "released") ?? list[0] ?? null;
    const people = await profilesById(ctx, [task.poster_id, assignment?.worker_id]);
    return {
      task,
      address: (privateRow.data as { address?: string | null } | null)?.address ?? null,
      assignment,
      poster: people.get(task.poster_id) ?? null,
      worker: assignment ? (people.get(assignment.worker_id) ?? null) : null,
    };
  },

  getPosterStats: async (ctx, a) => {
    const posterId = uuid(a, "posterId");
    const [profile, tasks] = await Promise.all([
      ctx.db.from("profiles").select(PROFILE_PUBLIC_SELECT).eq("id", posterId).maybeSingle(),
      ctx.db.from("tasks").select("id").eq("poster_id", posterId),
    ]);
    return { profile: take(profile), requestsPosted: rows(tasks).length };
  },

  getMyBid: async (ctx, a) =>
    take(
      await ctx.db.from("bids").select(BID_SELECT).eq("task_id", uuid(a, "taskId")).eq("worker_id", ctx.userId).maybeSingle(),
    ),

  /** Whether the caller may quote on a task, and why not when they may not. */
  canQuoteOn: async (ctx, a) => {
    const taskId = uuid(a, "taskId");
    const res = await ctx.db.from("tasks").select("poster_id,status,kind,hunt_window").eq("id", taskId).maybeSingle();
    const t = res.data as { poster_id: string; status: string; kind: string; hunt_window: string | null } | null;
    if (res.error || !t) return { allowed: true }; // let the write decide
    if (t.poster_id === ctx.userId) {
      return { allowed: false, code: "own", reason: "This is your own request — you cannot send an offer for it." };
    }
    if (t.kind !== "request") {
      return {
        allowed: false,
        code: "closed",
        reason: "This is a worker’s service, not a request — only requests take offers.",
      };
    }
    if (t.hunt_window) return { allowed: false, code: "closed", reason: "This is a Hunt: send a find instead of an offer." };
    if (t.status !== "OPEN") return { allowed: false, code: "closed", reason: "This request is no longer open for offers." };
    const mine = await ctx.db.from("bids").select("id").eq("task_id", taskId).eq("worker_id", ctx.userId).maybeSingle();
    if (mine.data) return { allowed: false, code: "duplicate", reason: "You already sent an offer for this task. You can edit it until the customer picks someone." };
    return { allowed: true };
  },

  getProof: async (ctx, a) => {
    const res = await ctx.db.from("task_proofs").select(PROOF_SELECT).eq("task_id", uuid(a, "taskId"))
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    return res.error ? null : (res.data ?? null);
  },

  promotableTasks: async (ctx) => {
    const list = rows<{ id: string; title: string; benchmark_minor: number; status: string }>(
      await ctx.db.from("tasks").select("id,title,benchmark_minor,status").eq("poster_id", ctx.userId)
        .in("status", ["OPEN"]).order("created_at", { ascending: false }).limit(30),
    );
    if (list.length === 0) return [];
    const counts = countBy(
      rows<{ task_id: string }>(await ctx.db.from("bids").select("task_id").in("task_id", list.map((r) => r.id))),
      (b) => b.task_id,
    );
    return list.map((r) => ({ ...r, quotes: counts[r.id] ?? 0 }));
  },

  /**
   * Open requests that match the caller's skills, best match first. With `near` (`{ lat, lng, radiusKm }`, the
   * worker's area), in-person requests are only those within the radius; remote ones come from anywhere (B156).
   */
  recommendedTasks: async (ctx, a) => {
    const n = limit(a, "limit", 10, 60);
    const near = nearArgOf(a);
    const newest = (q: ReturnType<typeof openTasksQuery>) => q.order("created_at", { ascending: false }).limit(60);
    const found = (near
      ? (await requestsInReach(ctx, near, newest)).sort(newestFirst)
      : rows<Task>(await newest(openTasksQuery(ctx, "request")))) as (Task & {
      title: string; category: string | null; skills: string[] | null; description: string;
    })[];
    const needles = strings(a, "skills")
      .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
      .filter(Boolean);
    if (needles.length === 0) return found.slice(0, n);
    const score = (t: (typeof found)[number]) => {
      const hay = [t.title, t.category ?? "", (t.skills ?? []).join(" "), t.description]
        .join(" ").toLowerCase().replace(/_/g, " ");
      return needles.reduce((sum, s) => sum + (hay.includes(s) ? 1 : 0), 0);
    };
    return found.map((t) => ({ t, s: score(t) })).sort((x, y) => y.s - x.s).map((x) => x.t).slice(0, n);
  },

  /** Open requests that can be done from anywhere: no pin at all. */
  remoteTasks: async (ctx, a) =>
    rows(
      await openTasksQuery(ctx, "request").is("loc_lat", null).order("created_at", { ascending: false })
        .limit(limit(a, "limit", 5)),
    ),

  /** Open, pinned requests within a radius, nearest first, each with its distance. */
  tasksNear: async (ctx, a) => {
    const at = { lat: num(a, "lat", -90, 90), lng: num(a, "lng", -180, 180) };
    const radius = num(a, "radiusKm", 0, 20000);
    // Narrowed to a box around the point before the cap, so newer far-away tasks cannot crowd out near ones (B34).
    const found = rows<Task>(
      await inBox(openTasksQuery(ctx, "request").not("loc_lat", "is", null), nearBox(at, radius))
        .order("created_at", { ascending: false }).limit(200),
    );
    return found
      .map((t) => ({ ...t, km: distanceKm(at, { lat: t.loc_lat, lng: t.loc_lng }) ?? Infinity }))
      .filter((x) => x.km <= radius)
      .sort((x, y) => x.km - y.km)
      .slice(0, limit(a, "limit", 5));
  },

  /** Urgent open requests, soonest due first. With `near`, only those in reach of it, as in recommendedTasks (B156). */
  urgentTasks: async (ctx, a) => {
    const n = limit(a, "limit", 3);
    const near = nearArgOf(a);
    const soonest = (q: ReturnType<typeof openTasksQuery>) =>
      q.eq("flag", "urgent").order("due_at", { ascending: true, nullsFirst: false });
    if (!near) return rows(await soonest(openTasksQuery(ctx, "request")).limit(n));
    // The pinned read is cut to the circle after SQL, so each read takes more than a page.
    return (await requestsInReach(ctx, near, (q) => soonest(q).limit(nearFetch(n)))).sort(soonestDue).slice(0, n);
  },

  /** The people the caller has blocked, newest first, so they can be unblocked (migration 093/097). */
  listBlockedUsers: async (ctx) => {
    const list = rows<{ blocked_id: string; created_at: string }>(
      await ctx.db.from("blocks").select("blocked_id, created_at").eq("blocker_id", ctx.userId)
        .order("created_at", { ascending: false }).limit(200),
    );
    const people = await profilesById(ctx, list.map((b) => b.blocked_id));
    return list.map((b) => ({
      id: b.blocked_id,
      name: String(people.get(b.blocked_id)?.display_name ?? "Someone"),
      blockedAt: b.created_at,
    }));
  },

  listSavedTaskIds: async (ctx) =>
    rows<{ task_id: string }>(await ctx.db.from("saved_tasks").select("task_id").eq("user_id", ctx.userId)).map(
      (r) => r.task_id,
    ),

  /** Saved tasks still visible to the caller (open, or theirs). */
  listSavedTasks: async (ctx) =>
    rows<{ tasks: Row | null }>(
      await ctx.db.from("saved_tasks").select(`task_id, created_at, ${TASKS_PUBLIC_EMBED}`).eq("user_id", ctx.userId)
        .order("created_at", { ascending: false }),
    ).map((r) => r.tasks).filter(Boolean),

  /** Tasks the caller is party to that are, or were, in dispute. */
  listMyDisputes: async (ctx) => {
    const [mine, worked] = await Promise.all([
      ctx.db.from("tasks").select(TASK_PARTY_SELECT).eq("poster_id", ctx.userId).eq("status", "DISPUTED").limit(MY_LIST_MAX),
      // Hired on each of these, so a party to every one.
      ctx.db.from("assignments").select(TASKS_PARTY_EMBED).eq("worker_id", ctx.userId).limit(MY_LIST_MAX),
    ]);
    const asWorker = rows<{ tasks: Task | null }>(worked).map((r) => r.tasks)
      .filter((t): t is Task => Boolean(t) && t!.status === "DISPUTED");
    const seen = new Set<string>();
    return [...rows<Task>(mine), ...asWorker].filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
  },

  /** What was said when each task was reported: { [taskId]: { reason, mine } }, newest report wins. */
  listDisputeReasons: async (ctx, a) => {
    const ids = uuids(a, "taskIds");
    const out: Record<string, { reason: string; mine: boolean }> = {};
    if (ids.length === 0) return out;
    const res = await ctx.db.from("task_disputes").select("task_id, reason, opened_by, created_at").in("task_id", ids)
      .order("created_at", { ascending: false });
    if (res.error) return out;
    for (const r of (res.data ?? []) as { task_id: string; reason: string; opened_by: string | null }[]) {
      if (!out[r.task_id]) out[r.task_id] = { reason: r.reason, mine: r.opened_by === ctx.userId };
    }
    return out;
  },

  // ------------------------------------------------------------- people ----
  getProfile: async (ctx, a) => {
    const id = uuid(a, "userId");
    // Your own row adds the referral code and weekly goal; anyone else's is the public fields only.
    // payout_upi (empty since migration 073, replaced by payout_destinations) and the sign-out cutoff fields are in no answer (H13, H45).
    return take(await ctx.db.from("profiles").select(id === ctx.userId ? PROFILE_OWNER_SELECT : PROFILE_PUBLIC_SELECT).eq("id", id).maybeSingle());
  },

  isAdmin: async (ctx) => {
    const res = await ctx.db.from("user_roles").select("role").eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
    return !res.error && Boolean(res.data);
  },

  /** Is this @handle free? Same rule as the database check. */
  usernameAvailable: async (ctx, a) => {
    const handle = typeof a.username === "string" ? a.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) return false;
    // Saving a reserved name is refused (writes.ts), so it is never shown as free (B69).
    if (RESERVED_USERNAMES.has(handle)) return false;
    const res = await ctx.db.from("profiles").select("id").eq("username", handle).maybeSingle();
    if (res.error) return false;
    const hit = res.data as { id: string } | null;
    return !hit || hit.id === ctx.userId;
  },

  /** Workers around lately, most recent first; only people who offer work; never the caller. */
  listActiveWorkers: async (ctx, a) => {
    const since = new Date((ctx.now?.() ?? new Date()).getTime() - 30 * 60_000).toISOString();
    const res = await ctx.db.from("profiles").select(PROFILE_PUBLIC_SELECT).gt("last_seen_at", since).not("onboarded_at", "is", null)
      .is("deleted_at", null) // deleted accounts never show in a list (B30)
      // PostgREST wants the empty array literally: skills=neq.{}
      .filter("skills", "neq", "{}").neq("id", ctx.userId)
      .order("last_seen_at", { ascending: false }).limit(limit(a, "limit", 12));
    return res.error ? [] : (res.data ?? []);
  },

  /**
   * People who offer work around a point, nearest first, for a poster's map.
   * Only the public, rounded area (migration 074) is used and sent, never the
   * private spot, and only the few fields a map card shows. Each comes with
   * their newest open service listing (`top_service`) and how many they have,
   * so the map can say what they offer; people with a listing but no skills
   * count as helpers too.
   */
  workersNear: async (ctx, a) => {
    const at = { lat: num(a, "lat", -90, 90), lng: num(a, "lng", -180, 180) };
    const radius = num(a, "radiusKm", 0, 20000);
    const cols = "id, display_name, username, avatar_url, skills, worker_rating_avg, worker_rating_count, last_seen_at, loc_lat, loc_lng, loc_label";
    // Narrowed to a box around the point before the 300 cap, so people seen more recently far away cannot crowd
    // out helpers nearby (B34).
    const box = nearBox(at, radius);
    const people = () =>
      inBox(ctx.db.from("profiles").select(cols)
        .not("onboarded_at", "is", null).is("deleted_at", null).not("loc_lat", "is", null).neq("id", ctx.userId), box);
    // Open service listings, newest first. B68: one newest-500 read across the whole country let a nearby older
    // listing drop out, so listings with a pin are read inside the same box, and listings with no pin (most of
    // them: a service is often not tied to a spot) are read on their own. Which helper a listing belongs to, and
    // how far away they are, still comes from the helper's public area below.
    const listingQuery = () =>
      ctx.db.from("tasks").select("id, poster_id, title, benchmark_minor, category, created_at")
        .eq("status", "OPEN").eq("kind", "service").neq("poster_id", ctx.userId);
    const [res, pinned, unpinned] = await Promise.all([
      // PostgREST wants the empty array literally: skills=neq.{}
      people().filter("skills", "neq", "{}").order("last_seen_at", { ascending: false, nullsFirst: false }).limit(300),
      inBox(listingQuery(), box).order("created_at", { ascending: false }).limit(500),
      listingQuery().is("loc_lat", null).order("created_at", { ascending: false }).limit(500),
    ]);
    // Listings fail soft: helpers still show, just without a service.
    // With no box (a huge radius) both reads can return the same unpinned listing: keep it once.
    const offerById = new Map<string, Row>();
    for (const r of [pinned, unpinned]) {
      if (r.error) continue;
      for (const t of (r.data ?? []) as Row[]) if (typeof t.poster_id === "string") offerById.set(String(t.id), t);
    }
    const listings = [...offerById.values()]
      .sort((x, y) => String(y.created_at ?? "").localeCompare(String(x.created_at ?? "")))
      .map((t) => ({
        id: String(t.id), poster_id: String(t.poster_id), title: String(t.title ?? ""),
        price_minor: Number(t.benchmark_minor ?? 0), category: (t.category as string | null) ?? null,
      }));
    const byPoster = new Map<string, typeof listings>();
    for (const l of listings) byPoster.set(l.poster_id, [...(byPoster.get(l.poster_id) ?? []), l]);
    const found = rows<Row & { id: string; loc_lat: number; loc_lng: number }>(res);
    const seen = new Set(found.map((p) => p.id));
    // Sellers with a listing pinned inside the box are asked for first, so unpinned listings from anywhere cannot
    // crowd them out of the 300.
    const posterIds = (r: typeof pinned) => (r.error ? [] : ((r.data ?? []) as Row[]).map((t) => t.poster_id));
    const sellersOnly = [...new Set([...posterIds(pinned), ...posterIds(unpinned)])]
      .filter((id): id is string => typeof id === "string" && !seen.has(id)).slice(0, 300);
    // Up to 300 ids, asked 100 at a time so the request address stays short.
    const chunks: string[][] = [];
    for (let i = 0; i < sellersOnly.length; i += 100) chunks.push(sellersOnly.slice(i, i + 100));
    for (const more of await Promise.all(chunks.map((ids) => people().in("id", ids)))) {
      if (!more.error) found.push(...((more.data ?? []) as typeof found));
    }
    return found
      .map((p) => {
        const mine = byPoster.get(p.id) ?? [];
        const top = mine[0];
        return {
          ...p,
          km: distanceKm(at, { lat: p.loc_lat, lng: p.loc_lng }) ?? Infinity,
          top_service: top ? { id: top.id, title: top.title, price_minor: top.price_minor, category: top.category } : null,
          service_count: mine.length,
        };
      })
      .filter((x) => x.km <= radius)
      .sort((x, y) => x.km - y.km)
      .slice(0, limit(a, "limit", 12));
  },

  /** One helper's open service listings, newest first: the cards on the map's helper sheet. */
  workerServices: async (ctx, a) =>
    rows(
      await openTasksQuery(ctx, "service").eq("poster_id", uuid(a, "userId"))
        .order("created_at", { ascending: false }).limit(limit(a, "limit", 10, 20)),
    ),

  /** Reviews about someone in one role. Poster and worker reputations are never merged. */
  listReviewsAbout: async (ctx, a) => {
    const list = rows<Row & { author_id: string }>(
      await ctx.db.from("reviews").select(REVIEW_SELECT).eq("subject_id", uuid(a, "userId"))
        .eq("about_role", oneOf(a, "role", ["admin", "poster", "worker"]))
        .order("created_at", { ascending: false }).limit(limit(a, "limit", 10)),
    );
    const people = await profilesById(ctx, list.map((r) => r.author_id));
    return list.map((r) => ({ ...r, author: people.get(r.author_id) ?? null }));
  },

  publicProfileStats: rpcOp("public_profile_stats", (a) => ({ p_user: uuid(a, "userId") })),

  // -------------------------------------------------- poster options ----
  /** A crew job's slots; names only for the crew itself (migration 134). */
  crewOverview: rpcOp("crew_overview", (a) => ({ p_crew: uuid(a, "crewId") })),
  listCrewMessages: async (ctx, a) =>
    rows(
      await ctx.db.from("crew_messages").select(CREW_MESSAGE_SELECT).eq("crew_id", uuid(a, "crewId"))
        .order("created_at", { ascending: true }).limit(limit(a, "limit", 200, 500)),
    ),
  /** Before-and-after photos a helper's customers let them show. */
  workerProofPhotos: rpcOp("worker_proof_photos", (a) => ({ p_worker: uuid(a, "userId") })),

  // ------------------------------------------------------- City Hunt ----
  /**
   * The finds on a Hunt (migration 158). The poster gets every find with the photo, place, pin, price and note
   * left out until they accept it; a finder gets their own finds; anyone else gets nothing. Decided in SQL.
   */
  huntFinds: rpcOp("hunt_finds_for_task", (a) => ({ p_task: uuid(a, "taskId") })),
  /** How many are looking and how many finds were sent, per Hunt, and the caller's own part. Numbers only. */
  huntCounts: async (ctx, a) => {
    const ids = uuids(a, "taskIds", 100);
    if (ids.length === 0) return [];
    return rows(await ctx.db.rpc("hunt_counts", { p_tasks: ids }));
  },
  /** The Earn side's weekly goal, on-time streak and badge counts. */
  myStreaks: rpcOp("my_streaks"),
  /**
   * People this poster hired for finished jobs, most jobs first, with the
   * categories they did: the Regulars list and the "offer it to them first" hint.
   */
  myRegulars: async (ctx) => {
    const done = rows<{ category: string | null; completed_at: string | null; assignments: { worker_id: string; status: string }[] | null }>(
      await ctx.db.from("tasks").select("category, completed_at, assignments(worker_id, status)")
        .eq("poster_id", ctx.userId).in("status", ["COMPLETED", "AUTO_COMPLETED"])
        .order("completed_at", { ascending: false }).limit(200),
    );
    const byWorker = new Map<string, { jobs: number; categories: Set<string>; lastAt: string | null }>();
    for (const t of done) {
      for (const as of t.assignments ?? []) {
        // Only the helper who was paid did the job: one who backed out (refunded) and was replaced did not (B67).
        if (as.status !== "released") continue;
        const seen = byWorker.get(as.worker_id) ?? { jobs: 0, categories: new Set<string>(), lastAt: t.completed_at };
        seen.jobs += 1;
        if (t.category) seen.categories.add(t.category);
        byWorker.set(as.worker_id, seen);
      }
    }
    const people = await profilesById(ctx, [...byWorker.keys()]);
    return [...byWorker.entries()]
      .filter(([id]) => people.has(id))
      .map(([id, s]) => ({ profile: people.get(id), jobs: s.jobs, categories: [...s.categories], lastAt: s.lastAt }))
      .sort((x, y) => y.jobs - x.jobs)
      .slice(0, 20);
  },

  /**
   * Who is on the map around a point (migrations 159 + 160): the caller's people (finished a task together) who
   * chose to share, with a live spot rounded to a ~550 m cell (kind "mine"), and other signed-in adults who chose
   * "everyone nearby" (kind "nearby": first name only, no photo, a ~2 km cell, within 25 km). Nearest first. The SQL
   * function does the rounding and every check; no exact position is ever read.
   */
  mapPeople: rpcOp("map_people_around", (a) => ({
    p_lat: num(a, "lat", -90, 90),
    p_lng: num(a, "lng", -180, 180),
    p_radius_km: num(a, "radiusKm", 0, 50),
  })),

  /** The caller's own sharing choice: { share_live, consented_at, notice_version, audience }, or null if never set. */
  mapSharing: async (ctx) =>
    take(await ctx.db.from("map_sharing").select("share_live, consented_at, notice_version, audience").eq("user_id", ctx.userId).maybeSingle()),

  ageStatus: async (ctx) => {
    const res = await ctx.db.from("age_checks").select("passed").eq("user_id", ctx.userId).maybeSingle();
    return Boolean((take(res) as { passed?: boolean } | null)?.passed);
  },

  // -------------------------------------------------------------- money ----
  getWallet: async (ctx) =>
    take(await ctx.db.from("wallets").select(WALLET_SELECT).eq("user_id", ctx.userId).maybeSingle()),

  /** Escrow tied up in live, paid-for jobs. With a side, only that side's. */
  getEscrowHeld: async (ctx, a) => {
    const side = a.side == null ? null : oneOf(a, "side", ["poster", "worker"]);
    type Held = { id: string; escrow_minor: number | null; worker_id: string; tasks: { poster_id?: string; funded_at?: string | null } | null };
    // Only the caller's own jobs, asked for in the query so a staff account does not read every assignment (S1-21).
    const base = () => ctx.db.from("assignments").select("id,escrow_minor,status,worker_id,tasks!inner(poster_id,funded_at)")
      .in("status", ["assigned", "started"]).limit(MY_LIST_MAX);
    const [asWorker, asPoster] = await Promise.all([
      side === "poster" ? null : base().eq("worker_id", ctx.userId),
      side === "worker" ? null : base().eq("tasks.poster_id", ctx.userId),
    ]);
    const seen = new Set<string>();
    const list = [...(asWorker ? rows<Held>(asWorker) : []), ...(asPoster ? rows<Held>(asPoster) : [])]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
    return list
      .filter((r) => {
        if (!r.tasks?.funded_at) return false; // locked but unpaid holds no money
        const poster = r.tasks.poster_id === ctx.userId;
        const worker = r.worker_id === ctx.userId;
        return side === "poster" ? poster : side === "worker" ? worker : poster || worker;
      })
      .reduce((sum, r) => sum + (r.escrow_minor ?? 0), 0);
  },

  /** What actually happened to the caller's money, newest first. */
  listWalletActivity: async (ctx, a) => {
    const uid = ctx.userId;
    const fees = await readFees(ctx);
    const [asWorker, asPoster, payouts, payments, finesRes] = await Promise.all([
      ctx.db.from("assignments").select(`${ASSIGNMENT_SELECT}, tasks(title)`).eq("worker_id", uid).limit(MY_LIST_MAX),
      ctx.db.from("tasks")
        .select("id,title,status,locked_minor,updated_at,funded_at,funded_minor,wallet_refunded_at,assignments(escrow_minor)")
        .eq("poster_id", uid).limit(MY_LIST_MAX),
      ctx.db.from("payouts").select(PAYOUT_SELECT).eq("user_id", uid).limit(MY_LIST_MAX),
      ctx.db.from("payments").select(PAYMENT_SELECT).eq("user_id", uid).eq("status", "paid").limit(MY_LIST_MAX),
      // Fines from a cancel after the work started (migration 170). Unreadable means "none known".
      ctx.db.rpc("my_cancel_fines"),
    ]);
    type Ev = { id: string; kind: string; title: string; meta: string; amountMinor: number; incoming: boolean; at: string };
    const events: Ev[] = [];
    type Fine = { task_id: string; fine_minor: number | string; side: string; at: string };
    const fines = finesRes.error ? [] : ((finesRes.data ?? []) as Fine[]);
    const posterFine = new Map<string, number>();
    for (const f of fines) if (f.side === "poster") posterFine.set(f.task_id, Number(f.fine_minor) || 0);

    for (const x of rows<Row & { id: string; status: string; escrow_minor: number; updated_at: string; tasks: { title?: string } | null }>(asWorker)) {
      const title = x.tasks?.title ?? "Task";
      if (x.status === "released") {
        events.push({
          id: "w-" + x.id, kind: "clearing", title: "Earned", meta: title + " · added to your wallet",
          amountMinor: workerShareOfEscrow(x.escrow_minor, fees), incoming: true, at: x.updated_at,
        });
      } else if (x.status === "started" || x.status === "assigned") {
        events.push({
          id: "w-" + x.id, kind: "incoming", title: "Coming to you",
          meta: title + (x.status === "started" ? " · in progress" : " · not started yet"),
          amountMinor: workerShareOfEscrow(x.escrow_minor, fees), incoming: false, at: x.updated_at,
        });
      }
    }

    for (const t of rows<{
      id: string; title: string; status: string; locked_minor: number | null; updated_at: string;
      funded_at: string | null; funded_minor: number | null; wallet_refunded_at: string | null;
      assignments: { escrow_minor: number }[] | null;
    }>(asPoster)) {
      // Only money actually paid in counts: a job locked but unpaid took nothing.
      if (!t.funded_at && !t.wallet_refunded_at) continue;
      // What the poster paid in: the price plus the service fee, as held on the assignment.
      const escrows = t.assignments ?? [];
      const paid = t.funded_minor ?? (escrows.length ? Math.max(...escrows.map((e) => e.escrow_minor)) : (t.locked_minor ?? 0));
      if (t.status === "COMPLETED" || t.status === "AUTO_COMPLETED") {
        events.push({ id: "p-" + t.id, kind: "released", title: "Paid to worker", meta: t.title + " · completed", amountMinor: paid, incoming: false, at: t.updated_at });
      } else if (IN_PROGRESS.has(t.status)) {
        events.push({ id: "p-" + t.id, kind: "escrow", title: "Locked in a task", meta: t.title + " · can’t be withdrawn until it’s done", amountMinor: paid, incoming: false, at: t.updated_at });
      } else if (t.status === "CANCELLED" && t.wallet_refunded_at) {
        // A cancel after the work started paid the worker a fine out of this money; the rest came back.
        const fine = Math.min(posterFine.get(t.id) ?? 0, paid);
        events.push(fine > 0
          ? { id: "r-" + t.id, kind: "topup", title: "Returned to your wallet", meta: t.title + " · cancelled after work started, ₹" + rupeesText(fine) + " fine kept for the worker", amountMinor: paid - fine, incoming: true, at: t.wallet_refunded_at }
          : { id: "r-" + t.id, kind: "topup", title: "Returned to your wallet", meta: t.title + " · not completed, full refund", amountMinor: paid, incoming: true, at: t.wallet_refunded_at });
      }
    }

    // The worker's side of the same fine: paid for the time already spent.
    const workerTitles = new Map<string, string>();
    for (const x of rows<{ task_id: string; tasks: { title?: string } | null }>(asWorker)) workerTitles.set(x.task_id, x.tasks?.title ?? "Task");
    for (const f of fines) {
      const amount = Number(f.fine_minor) || 0;
      if (f.side !== "worker" || amount <= 0) continue;
      events.push({
        id: "f-" + f.task_id, kind: "clearing", title: "Paid for your time",
        meta: (workerTitles.get(f.task_id) ?? "Task") + " · cancelled after you started",
        amountMinor: amount, incoming: true, at: f.at,
      });
    }

    for (const o of rows<{ id: string; status: string; destination: string | null; amount_minor: number; created_at: string }>(payouts)) {
      const title =
        o.status === "paid" ? "Sent to your bank"
        : o.status === "failed" ? "Transfer failed"
        : o.status === "cancelled" ? "Withdrawal cancelled"
        : o.status === "processing" ? "Transfer on its way"
        : (o.destination ?? "").includes("@") ? "Withdrawal request via UPI"
        : "Withdrawal requested";
      events.push({
        id: "o-" + o.id, kind: "payout", title, meta: o.destination ?? "To your account", amountMinor: o.amount_minor,
        // Cancelled and failed both put the money back in the wallet.
        incoming: o.status === "cancelled" || o.status === "failed", at: o.created_at,
      });
    }

    for (const p of rows<{ id: string; purpose: string; amount_minor: number; paid_at: string | null; created_at: string }>(payments)) {
      // An escrow payment is already listed as its task's event; only top-ups stand alone.
      if (p.purpose !== "topup") continue;
      events.push({ id: "c-" + p.id, kind: "topup", title: "Deposit via Razorpay", meta: "Added to your wallet", amountMinor: p.amount_minor, incoming: true, at: p.paid_at ?? p.created_at });
    }

    events.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
    return events.slice(0, limit(a, "limit", 12, 500));
  },

  /** Plan B (migration 195): which money flow is on, and the caller's payee state. */
  getMoneyMode: rpcOp("my_money_mode"),

  /** Plan B: the hold on one task (null when none), for either side of the task. */
  getTaskHold: rpcOp("my_task_hold", (a) => ({ p_task_id: uuid(a, "taskId") })),

  /** Plan B: the caller's own money record and totals. */
  getMoneyLedger: rpcOp("my_money_ledger", (a) => ({ p_limit: limit(a, "limit", 100, 500) })),

  listPayouts: async (ctx, a) =>
    rows(await ctx.db.from("payouts").select(PAYOUT_SELECT).eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(limit(a, "limit", 20))),

  listPayoutDestinations: async (ctx) =>
    rows(
      await ctx.db.from("payout_destinations").select(PAYOUT_DESTINATION_SELECT).eq("user_id", ctx.userId)
        .order("is_default", { ascending: false }).order("created_at", { ascending: false }),
    ),

  listPromotions: async (ctx) =>
    rows(await ctx.db.from("task_promotions").select(`${PROMOTION_SELECT}, day_budget_minor, spent_minor, alerted_count, task:tasks(title, kind, status)`).eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(20)),

  /** The Promote screen's facts for one of my posts (migration 203): budget limits, lengths, how busy the area is, campaign. */
  promotionQuote: rpcOp("promotion_quote", (a) => ({ p_task_id: uuid(a, "taskId") })),
  /**
   * The auction for the top places (migration 203): live promotions of one kind near the caller, the top places
   * marked. A new top place is charged its second price in the database, once; the same place again within a few
   * minutes is free, so a retry never charges twice. Never reused (freshness NEVER_REUSE). taskIds: the posts in the
   * list the caller is looking at (after filters); only those can win.
   */
  promotedLive: rpcOp("promoted_live", (a) => ({
    p_kind: oneOf(a, "kind", ["request", "service"]),
    p_lat: coordOrNull(a, "lat", 90),
    p_lng: coordOrNull(a, "lng", 180),
    p_radius_km: int(a, "radiusKm", 1, 100, 10),
    p_surface: oneOf(a, "surface", ["list", "home", "map", "search"], "list"),
    p_task_ids: a.taskIds == null ? null : uuids(a, "taskIds", 500),
  })),
  /** What the payer of one promotion sees: spend, top shows, price, saw it, opened, by place, offers, alerted (owner only). */
  promotionResults: rpcOp("promotion_results", (a) => ({ p_promotion_id: uuid(a, "promotionId") })),

  /** The live ad auction's running order: { [taskId]: rank }. Rank 1 wins. */
  adAuctionRanks: async (ctx) => {
    const res = await ctx.db.rpc("ad_auction");
    // Same `{}` as always, marked so the shared memo (3.5b layer D) never keeps an answer born of an error.
    if (res.error) return noKeep({});
    const out: Record<string, number> = {};
    for (const r of (res.data ?? []) as { task_id: string; rank: number | null }[]) out[r.task_id] = Number(r.rank ?? 0);
    return out;
  },

  /** The live fee settings, with the defaults when a key is missing. */
  platformFees: (ctx) => readFees(ctx),

  /**
   * The promotion budgets and lengths staff set in the admin (migration 114), as stored. The app
   * checks their shape and falls back to its defaults; startPromotion still refuses anything else.
   * The app used to read the settings table itself, which the gateway-only lockdown would stop.
   */
  promotionTiers: async (ctx) => {
    const list = rows<{ key: string; value: unknown }>(
      await ctx.db.from("settings").select("key,value").in("key", ["promotion_daily_budgets_minor", "promotion_durations_days"]),
    );
    const value = (k: string) => list.find((r) => r.key === k)?.value ?? null;
    return { budgetsMinor: value("promotion_daily_budgets_minor"), days: value("promotion_durations_days") };
  },

  /** Platform fees the caller actually paid since a date, from the rows that moved the money. */
  feesSince: async (ctx, a) => {
    const iso = isoOrNull(a, "since") ?? "1970-01-01T00:00:00Z";
    // The commission is read here, not taken from the app: an argument named
    // "commission" is still accepted (the old app sends one) and ignored.
    const { commission } = await readFees(ctx);
    const [posted, worked] = await Promise.all([
      ctx.db.from("tasks").select("id, locked_minor, funded_at, assignments(escrow_minor)").eq("poster_id", ctx.userId)
        .not("funded_at", "is", null).gte("funded_at", iso),
      ctx.db.from("assignments").select("worker_id, tasks!inner(locked_minor, status, completed_at)").eq("worker_id", ctx.userId),
    ]);
    let serviceMinor = 0;
    for (const t of (posted.data ?? []) as { locked_minor: number | null; assignments: { escrow_minor: number }[] | null }[]) {
      const held = Math.max(0, ...(t.assignments ?? []).map((x) => x.escrow_minor));
      serviceMinor += Math.max(0, held - (t.locked_minor ?? 0));
    }
    let commissionMinor = 0;
    for (const x of (worked.data ?? []) as { tasks: { locked_minor: number | null; status: string; completed_at: string | null } | null }[]) {
      const t = x.tasks;
      if (!t || !["COMPLETED", "AUTO_COMPLETED"].includes(t.status)) continue;
      if (t.completed_at && t.completed_at < iso) continue;
      commissionMinor += Math.round((t.locked_minor ?? 0) * commission);
    }
    return { serviceMinor, commissionMinor };
  },

  myStats: rpcOp("my_stats", (a) => ({ p_role: oneOf(a, "role", ["worker", "poster"]) })),
  /** What would stop the caller deleting their account right now (migration 087). */
  accountDeletionCheck: rpcOp("account_deletion_check"),
  platformStats: rpcOp("platform_stats", (a) => ({ p_days: int(a, "days", 1, 3650, 30) })),
  platformHighlights: rpcOp("platform_highlights"),
  listCatalog: rpcOp("catalog_list", (a) => ({ p_kind: catalogKind(a) })),
  checkCatalogTerm: async (ctx, a) => {
    const kind = catalogKind(a);
    const text = str(a, "text", 60);
    const refused = catalogContactRefusal(kind, text);
    if (refused) return refused;
    const res = catalogRefusal(kind, take<Record<string, unknown>>(await catalogCall(ctx, "catalog_check_for", await catalogArgs(kind, text))));
    void ctx.catalogEmbeddings?.().catch(() => {});
    return res;
  },
  trendingCategories: rpcOp("trending_categories", (a) => ({ p_limit: limit(a, "limit", 8, 50) })),
  topEarners: rpcOp("top_earners", (a) => ({
    p_kind: oneOf(a, "kind", ["top_rated", "most_active", "new_talent"]),
    p_limit: limit(a, "limit", 10, 50),
  })),

  // ----------------------------------------------------- attention & inbox ----
  /** How many things are waiting on the caller right now, for one side. */
  countNeedsAttention: async (ctx, a) => {
    if (oneOf(a, "mode", ["poster", "worker"]) === "poster") {
      const mine = rows<{ id: string; status: string }>(await ctx.db.from("tasks").select("id,status").eq("poster_id", ctx.userId).limit(MY_LIST_MAX));
      let count = mine.filter((t) => t.status === "WORK_DONE").length; // waiting on them to release
      const open = mine.filter((t) => t.status === "OPEN").map((t) => t.id);
      if (open.length) {
        const quoted = new Set(rows<{ task_id: string }>(await ctx.db.from("bids").select("task_id").in("task_id", open)).map((b) => b.task_id));
        count += open.filter((id) => quoted.has(id)).length; // quotes arrived on something open
      }
      return count;
    }
    const list = rows<{ tasks: { status?: string } | null }>(
      await ctx.db.from("assignments").select("status, tasks(status)").eq("worker_id", ctx.userId).in("status", ["assigned", "started"]).limit(MY_LIST_MAX),
    );
    return list.filter((x) => x.tasks?.status === "LOCKED").length; // picked but not started
  },

  /** Every conversation the caller is part of, newest first. A thread exists from the hire, not the first message. */
  listThreads: async (ctx) => {
    const LIVE = [...IN_PROGRESS];
    const [msgRes, postedRes, hiredRes] = await Promise.all([
      ctx.db.rpc("my_thread_latest"),
      ctx.db.from("tasks").select("id,title,status,updated_at").eq("poster_id", ctx.userId).in("status", LIVE),
      ctx.db.from("assignments").select("task_id").eq("worker_id", ctx.userId).in("status", ["assigned", "started"]),
    ]);
    // One latest message per conversation, newest first (migration 191): an old chat no longer drops out (S1-23).
    const msgs = rows<{ task_id: string; body: string; created_at: string; sender_id: string }>(msgRes);
    const latest = new Map<string, (typeof msgs)[number]>();
    for (const m of msgs) if (!latest.has(m.task_id)) latest.set(m.task_id, m);
    const ids = new Set<string>([
      ...latest.keys(),
      ...((postedRes.data ?? []) as { id: string }[]).map((t) => t.id),
      ...((hiredRes.data ?? []) as { task_id: string }[]).map((x) => x.task_id),
    ]);
    if (ids.size === 0) return [];
    const tasks = rows<{ id: string; title: string; status: string; updated_at: string }>(
      await ctx.db.from("tasks").select("id,title,status,updated_at").in("id", [...ids]),
    );
    const byId = new Map(tasks.map((t) => [t.id, t]));
    // 1.19 row B: whether each chat is open, closing (48 hours after completion) or closed, and why.
    // A failed read leaves `chat` null rather than failing the list.
    const chats = await readChatStates(ctx, [...ids], true);
    return [...ids]
      .map((id) => {
        const m = latest.get(id);
        const t = byId.get(id);
        return {
          chat: chats.get(id) ?? null,
          taskId: id,
          title: t?.title ?? "Task",
          status: t?.status ?? "",
          lastBody: m ? (m.body.startsWith("::media::") ? "📷 Photo" : m.body) : "",
          lastAt: m?.created_at ?? t?.updated_at ?? (ctx.now?.() ?? new Date()).toISOString(),
          lastFromMe: m ? m.sender_id === ctx.userId : false,
        };
      })
      .sort((x, y) => new Date(y.lastAt).getTime() - new Date(x.lastAt).getTime());
  },

  /**
   * 1.19 row B (migration 215): the caller's chat state for one task, for the notice above the message box:
   * { taskId, open, state: 'open' | 'closing' | 'closed', reason, message, closesAt, deleteAfter }.
   */
  chatState: async (ctx, a) => {
    const taskId = uuid(a, "taskId");
    return (await readChatStates(ctx, [taskId])).get(taskId) ?? chatStateFrom({
      task_id: taskId, state: "closed", can_send: false, reason: "not_participant", closes_at: null, delete_after: null,
    });
  },

  /** A task's thread, oldest first; with `after`, only messages newer than it. */
  listMessages: async (ctx, a) => {
    let q = ctx.db.from("messages").select(MESSAGE_SELECT).eq("task_id", uuid(a, "taskId"));
    const after = isoOrNull(a, "after");
    if (after) q = q.gt("created_at", after);
    // Without `after` this is the newest MY_LIST_MAX messages of a long chat, shown oldest first (S1-21).
    if (after) return rows(await q.order("created_at").limit(MY_LIST_MAX));
    return rows(await q.order("created_at", { ascending: false }).limit(MY_LIST_MAX)).reverse();
  },

  /** The other side's phone number, once the work has started; null for none. */
  taskContactPhone: async (ctx, a) => {
    const data = take(await ctx.db.rpc("task_contact_phone", { p_task_id: uuid(a, "taskId") }));
    return typeof data === "string" && data ? data : null;
  },

  // ------------------------------------------------------- notifications ----
  listNotifications: async (ctx, a) =>
    rows(await ctx.db.from("notifications").select(NOTIFICATION_SELECT).eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(limit(a, "limit", 50))),

  getNotification: async (ctx, a) =>
    take(await ctx.db.from("notifications").select(NOTIFICATION_SELECT).eq("id", uuid(a, "id")).eq("user_id", ctx.userId).maybeSingle()),

  countUnreadNotifications: async (ctx) => {
    const res = await ctx.db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ctx.userId).is("read_at", null);
    return res.error ? 0 : (res.count ?? 0);
  },

  /** Which side each notification belongs to: { [id]: 'poster' | 'worker' | 'both' }. */
  notificationSides: async (ctx, a) => {
    const list = a.rows;
    if (!Array.isArray(list) || list.length > 500) throw bad("rows");
    const items = list.map((r) => {
      const x = (r ?? {}) as Args;
      return { id: uuid(x, "id"), task_id: x.task_id == null ? null : uuid(x, "task_id") };
    });
    return sidesFor(ctx, items);
  },

  /** Unread notifications for one side, plus those that belong to both. */
  countUnreadFor: async (ctx, a) => {
    const side = oneOf(a, "side", ["poster", "worker"]);
    const res = await ctx.db.from("notifications").select("id,task_id").eq("user_id", ctx.userId).is("read_at", null).limit(2000);
    if (res.error || !res.data) return 0;
    const items = res.data as { id: string; task_id: string | null }[];
    const sides = await sidesFor(ctx, items);
    return items.filter((n) => sides[n.id] === side || sides[n.id] === "both").length;
  },

  // ------------------------------------------------------ feedback board ----
  /** The public feedback board (migration 136): top or newest ideas, filtered by status, kind or a search. */
  listFeedbackBoard: rpcOp("feedback_board_list", (a) => ({
    p_sort: oneOf(a, "sort", ["top", "new"], "top"),
    p_status: a.status == null ? null : oneOf(a, "status", ["open", "under_review", "planned", "in_progress", "done", "declined"]),
    p_category: a.category == null ? null : oneOf(a, "category", ["feature", "improvement", "bug", "other"]),
    p_search: strOrNull(a, "search", 60),
    p_limit: limit(a, "limit", 30, 50),
    p_offset: int(a, "offset", 0, 10_000, 0),
  })),

  /** One idea with its comments; null once it is hidden or gone. */
  getFeedbackPost: rpcOp("feedback_board_get", (a) => ({ p_post: uuid(a, "postId") })),

  // ------------------------------------------------- questions on a task ----
  /** Workers' questions on a task and the poster's answers, oldest first (migration 140). */
  listTaskQuestions: rpcOp("task_questions_list", (a) => ({ p_task: uuid(a, "taskId") })),

  /** Tasks finished near a point today and helpers active there now: two counts, nothing else (migration 140). */
  nearbyPulse: rpcOp("nearby_pulse", (a) => ({
    p_lat: num(a, "lat", -90, 90),
    p_lng: num(a, "lng", -180, 180),
    p_radius_km: num(a, "radiusKm", 2, 25),
  })),

  // ------------------------------------------------------- support & more ----
  listTickets: async (ctx) =>
    rows(await ctx.db.from("support_tickets").select(SUPPORT_TICKET_SELECT).eq("user_id", ctx.userId).order("updated_at", { ascending: false }).limit(MY_LIST_MAX)),

  getTicket: async (ctx, a) => {
    const id = uuid(a, "ticketId");
    const ticket = take(await ctx.db.from("support_tickets").select(SUPPORT_TICKET_SELECT).eq("id", id).maybeSingle());
    if (!ticket) return null;
    return { ticket, messages: rows(await ctx.db.from("support_messages").select(SUPPORT_MESSAGE_SELECT).eq("ticket_id", id).order("created_at").limit(MY_LIST_MAX)) };
  },

  countMyReferrals: async (ctx) => {
    const res = await ctx.db.from("referrals").select("referred_id", { count: "exact", head: true }).eq("referrer_id", ctx.userId);
    return res.error ? 0 : (res.count ?? 0);
  },
};

/** A notification about a task the caller posted is the poster side's; about any other task, the worker side's. */
async function sidesFor(ctx: Ctx, items: { id: string; task_id: string | null }[]): Promise<Record<string, string>> {
  const taskIds = [...new Set(items.map((r) => r.task_id).filter((x): x is string => Boolean(x)))];
  const owner = new Map<string, string>();
  if (taskIds.length) {
    // In groups, so a long list does not make a web address too long for the database.
    for (let i = 0; i < taskIds.length; i += 100) {
      const res = await ctx.db.from("tasks").select("id, poster_id").in("id", taskIds.slice(i, i + 100));
      for (const t of (res.data ?? []) as { id: string; poster_id: string }[]) owner.set(t.id, t.poster_id);
    }
  }
  const out: Record<string, string> = {};
  for (const r of items) out[r.id] = !r.task_id ? "both" : owner.get(r.task_id) === ctx.userId ? "poster" : "worker";
  return out;
}
