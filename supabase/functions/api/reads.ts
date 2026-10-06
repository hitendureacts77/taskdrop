import { FEES, distanceKm, workerNetPayout } from "../_shared/rules.ts";
import {
  type Args, type Ctx, type Op, MONEY_MAX, bad, countBy, int, isoOrNull, limit, notExpired, num, oneOf, rows,
  rpcOp, str, strings, take, uuid, uuids,
} from "./core.ts";

/**
 * Everything the app reads. "My" queries always say whose rows they mean, using
 * the caller's id from their session: an admin's policies match every row, so
 * a query that leaned on row level security alone would silently turn into
 * "everybody's rows" for a staff account.
 */

type Row = Record<string, unknown>;
type Task = Row & { id: string; poster_id: string; status: string; loc_lat: number | null; loc_lng: number | null };

/** Profiles for a set of ids, keyed by id. */
async function profilesById(ctx: Ctx, ids: (string | null | undefined)[]): Promise<Map<string, Row>> {
  const want = [...new Set(ids.filter((x): x is string => Boolean(x)))];
  if (want.length === 0) return new Map();
  const people = rows<Row & { id: string }>(await ctx.db.from("profiles").select("*").in("id", want));
  return new Map(people.map((p) => [p.id, p]));
}

/** Open posts of one kind that the caller could take on (never their own). */
function openTasksQuery(ctx: Ctx, kind: "request" | "service") {
  return ctx.db
    .from("tasks")
    .select("*")
    .eq("status", "OPEN")
    .or(notExpired(ctx))
    .eq("kind", kind)
    .neq("poster_id", ctx.userId);
}

const kindArg = (a: Args) => oneOf(a, "kind", ["request", "service"], "request");

/** A task still holding money: chosen and paid for, but not yet finished. */
const IN_PROGRESS = new Set(["LOCKED", "TASK_STARTED", "OVERDUE", "WORK_DONE", "REVISION_REQUESTED", "DISPUTED"]);

/** What reaches a worker from an escrow: the price (escrow less the poster's fee), less commission. */
const workerShareOfEscrow = (escrowMinor: number) =>
  workerNetPayout(Math.round(escrowMinor / (1 + FEES.POSTER_SERVICE_FEE_PCT)));

export const READ_OPS: Record<string, Op> = {
  // ------------------------------------------------------------- tasks ----
  listOpenTasks: async (ctx, a) =>
    rows(await openTasksQuery(ctx, kindArg(a)).order("created_at", { ascending: false }).limit(limit(a))),

  listMyTasks: async (ctx, a) =>
    rows(
      await ctx.db.from("tasks").select("*").eq("poster_id", ctx.userId).eq("kind", kindArg(a))
        .order("created_at", { ascending: false }),
    ),

  listMyBids: async (ctx) =>
    rows(await ctx.db.from("bids").select("*, tasks(*)").eq("worker_id", ctx.userId).order("created_at", { ascending: false })),

  listMyAssignments: async (ctx) =>
    rows(
      await ctx.db.from("assignments").select("*, tasks(*)").eq("worker_id", ctx.userId)
        .order("created_at", { ascending: false }),
    ),

  /** Incoming quotes on a task, cheapest first, each with the worker's profile. */
  listBidsForTask: async (ctx, a) => {
    const bids = rows<Row & { worker_id: string }>(
      await ctx.db.from("bids").select("*").eq("task_id", uuid(a, "taskId")).order("price_minor"),
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

  /** Open tasks matching the search screen's filters. Every filter is optional. */
  searchTasks: async (ctx, a) => {
    // Checked before anything is asked of the database.
    const nearArg = a.near as Args | null | undefined;
    if (nearArg != null && typeof nearArg !== "object") throw bad("near");
    const near = nearArg
      ? { lat: num(nearArg, "lat", -90, 90), lng: num(nearArg, "lng", -180, 180), radius: num(nearArg, "radiusKm", 0, 20000) }
      : null;

    let q = openTasksQuery(ctx, kindArg(a));
    const text = typeof a.q === "string" ? a.q.trim().slice(0, 200) : "";
    if (text) {
      // Commas and parens would break out of PostgREST's or() filter grammar.
      const safe = text.replace(/[,()*%\\]/g, " ").trim();
      if (safe) q = q.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
    }
    if (a.pillar != null) q = q.eq("pillar", str(a, "pillar", 40));
    if (typeof a.minMinor === "number") q = q.gte("benchmark_minor", int(a, "minMinor", 0, MONEY_MAX));
    if (typeof a.maxMinor === "number") q = q.lte("benchmark_minor", int(a, "maxMinor", 0, MONEY_MAX));
    const found = rows<Task>(await q.order("created_at", { ascending: false }).limit(limit(a)));

    // Distance is filtered here rather than in SQL: there is no geo index on this
    // table and the page is already capped. A task with no pin cannot be shown
    // to be within any radius, so it is not.
    if (!near) return found;
    return found.filter((t) => {
      const km = distanceKm(near, { lat: t.loc_lat, lng: t.loc_lng });
      return km !== null && km <= near.radius;
    });
  },

  /** Attach each task's poster profile, for feed rows that show identity. */
  attachPosters: async (ctx, a) => {
    const ids = uuids(a, "taskIds");
    if (ids.length === 0) return [];
    const tasks = rows<Task>(await ctx.db.from("tasks").select("*").in("id", ids));
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const people = await profilesById(ctx, tasks.map((t) => t.poster_id));
    // Same order the caller asked in; anything no longer visible drops out.
    return ids
      .map((id) => byId.get(id))
      .filter((t): t is Task => Boolean(t))
      .map((t) => ({ ...t, poster: people.get(t.poster_id) ?? null }));
  },

  getTask: async (ctx, a) => take(await ctx.db.from("tasks").select("*").eq("id", uuid(a, "taskId")).maybeSingle()),

  /** The task, the assignment holding its escrow, and both people, in one round trip. */
  getTaskDetail: async (ctx, a) => {
    const taskId = uuid(a, "taskId");
    const task = take<Task | null>(await ctx.db.from("tasks").select("*").eq("id", taskId).maybeSingle());
    if (!task) return null;
    const list = rows<Row & { status: string; worker_id: string }>(
      await ctx.db.from("assignments").select("*").eq("task_id", taskId).order("created_at", { ascending: false }),
    );
    // A task can carry stale holds from workers who lost the race to start.
    const assignment = list.find((x) => x.status === "started" || x.status === "released") ?? list[0] ?? null;
    const people = await profilesById(ctx, [task.poster_id, assignment?.worker_id]);
    return {
      task,
      assignment,
      poster: people.get(task.poster_id) ?? null,
      worker: assignment ? (people.get(assignment.worker_id) ?? null) : null,
    };
  },

  getPosterStats: async (ctx, a) => {
    const posterId = uuid(a, "posterId");
    const [profile, tasks] = await Promise.all([
      ctx.db.from("profiles").select("*").eq("id", posterId).maybeSingle(),
      ctx.db.from("tasks").select("id").eq("poster_id", posterId),
    ]);
    return { profile: take(profile), requestsPosted: rows(tasks).length };
  },

  getMyBid: async (ctx, a) =>
    take(
      await ctx.db.from("bids").select("*").eq("task_id", uuid(a, "taskId")).eq("worker_id", ctx.userId).maybeSingle(),
    ),

  /** Whether the caller may quote on a task, and why not when they may not. */
  canQuoteOn: async (ctx, a) => {
    const taskId = uuid(a, "taskId");
    const res = await ctx.db.from("tasks").select("poster_id,status,kind").eq("id", taskId).maybeSingle();
    const t = res.data as { poster_id: string; status: string; kind: string } | null;
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
    if (t.status !== "OPEN") return { allowed: false, code: "closed", reason: "This request is no longer open for offers." };
    const mine = await ctx.db.from("bids").select("id").eq("task_id", taskId).eq("worker_id", ctx.userId).maybeSingle();
    if (mine.data) return { allowed: false, code: "duplicate", reason: "You have already sent an offer for this task." };
    return { allowed: true };
  },

  getProof: async (ctx, a) => {
    const res = await ctx.db.from("task_proofs").select("*").eq("task_id", uuid(a, "taskId"))
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

  recommendedTasks: async (ctx, a) => {
    const n = limit(a, "limit", 10, 60);
    const found = rows<Task & { title: string; category: string | null; skills: string[] | null; description: string }>(
      await openTasksQuery(ctx, "request").order("created_at", { ascending: false }).limit(60),
    );
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
    const found = rows<Task>(
      await openTasksQuery(ctx, "request").not("loc_lat", "is", null).order("created_at", { ascending: false }).limit(200),
    );
    return found
      .map((t) => ({ ...t, km: distanceKm(at, { lat: t.loc_lat, lng: t.loc_lng }) ?? Infinity }))
      .filter((x) => x.km <= radius)
      .sort((x, y) => x.km - y.km)
      .slice(0, limit(a, "limit", 5));
  },

  urgentTasks: async (ctx, a) =>
    rows(
      await openTasksQuery(ctx, "request").eq("flag", "urgent").order("due_at", { ascending: true, nullsFirst: false })
        .limit(limit(a, "limit", 3)),
    ),

  listSavedTaskIds: async (ctx) =>
    rows<{ task_id: string }>(await ctx.db.from("saved_tasks").select("task_id").eq("user_id", ctx.userId)).map(
      (r) => r.task_id,
    ),

  /** Saved tasks still visible to the caller (open, or theirs). */
  listSavedTasks: async (ctx) =>
    rows<{ tasks: Row | null }>(
      await ctx.db.from("saved_tasks").select("task_id, created_at, tasks(*)").eq("user_id", ctx.userId)
        .order("created_at", { ascending: false }),
    ).map((r) => r.tasks).filter(Boolean),

  /** Tasks the caller is party to that are, or were, in dispute. */
  listMyDisputes: async (ctx) => {
    const [mine, worked] = await Promise.all([
      ctx.db.from("tasks").select("*").eq("poster_id", ctx.userId).eq("status", "DISPUTED"),
      ctx.db.from("assignments").select("tasks(*)").eq("worker_id", ctx.userId),
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
  getProfile: async (ctx, a) => take(await ctx.db.from("profiles").select("*").eq("id", uuid(a, "userId")).maybeSingle()),

  isAdmin: async (ctx) => {
    const res = await ctx.db.from("user_roles").select("role").eq("user_id", ctx.userId).eq("role", "admin").maybeSingle();
    return !res.error && Boolean(res.data);
  },

  /** Is this @handle free? Same rule as the database check. */
  usernameAvailable: async (ctx, a) => {
    const handle = typeof a.username === "string" ? a.username.trim().toLowerCase() : "";
    if (!/^[a-z0-9_]{3,20}$/.test(handle)) return false;
    const res = await ctx.db.from("profiles").select("id").eq("username", handle).maybeSingle();
    if (res.error) return false;
    const hit = res.data as { id: string } | null;
    return !hit || hit.id === ctx.userId;
  },

  /** Workers around lately, most recent first; only people who offer work; never the caller. */
  listActiveWorkers: async (ctx, a) => {
    const since = new Date((ctx.now?.() ?? new Date()).getTime() - 30 * 60_000).toISOString();
    const res = await ctx.db.from("profiles").select("*").gt("last_seen_at", since).not("onboarded_at", "is", null)
      // PostgREST wants the empty array literally: skills=neq.{}
      .filter("skills", "neq", "{}").neq("id", ctx.userId)
      .order("last_seen_at", { ascending: false }).limit(limit(a, "limit", 12));
    return res.error ? [] : (res.data ?? []);
  },

  /** Reviews about someone in one role. Poster and worker reputations are never merged. */
  listReviewsAbout: async (ctx, a) => {
    const list = rows<Row & { author_id: string }>(
      await ctx.db.from("reviews").select("*").eq("subject_id", uuid(a, "userId"))
        .eq("about_role", oneOf(a, "role", ["admin", "poster", "worker"]))
        .order("created_at", { ascending: false }).limit(limit(a, "limit", 10)),
    );
    const people = await profilesById(ctx, list.map((r) => r.author_id));
    return list.map((r) => ({ ...r, author: people.get(r.author_id) ?? null }));
  },

  publicProfileStats: rpcOp("public_profile_stats", (a) => ({ p_user: uuid(a, "userId") })),
  ageStatus: async (ctx) => {
    const res = await ctx.db.from("age_checks").select("passed").eq("user_id", ctx.userId).maybeSingle();
    return Boolean((take(res) as { passed?: boolean } | null)?.passed);
  },

  // -------------------------------------------------------------- money ----
  getWallet: async (ctx) =>
    take(await ctx.db.from("wallets").select("*").eq("user_id", ctx.userId).maybeSingle()),

  /** Escrow tied up in live, paid-for jobs. With a side, only that side's. */
  getEscrowHeld: async (ctx, a) => {
    const side = a.side == null ? null : oneOf(a, "side", ["poster", "worker"]);
    const list = rows<{ escrow_minor: number | null; worker_id: string; tasks: { poster_id?: string; funded_at?: string | null } | null }>(
      await ctx.db.from("assignments").select("escrow_minor,status,worker_id,tasks!inner(poster_id,funded_at)")
        .in("status", ["assigned", "started"]),
    );
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
    const [asWorker, asPoster, payouts, payments] = await Promise.all([
      ctx.db.from("assignments").select("*, tasks(title)").eq("worker_id", uid),
      ctx.db.from("tasks")
        .select("id,title,status,locked_minor,updated_at,funded_at,funded_minor,wallet_refunded_at,assignments(escrow_minor)")
        .eq("poster_id", uid),
      ctx.db.from("payouts").select("*").eq("user_id", uid),
      ctx.db.from("payments").select("*").eq("user_id", uid).eq("status", "paid"),
    ]);
    type Ev = { id: string; kind: string; title: string; meta: string; amountMinor: number; incoming: boolean; at: string };
    const events: Ev[] = [];

    for (const x of rows<Row & { id: string; status: string; escrow_minor: number; updated_at: string; tasks: { title?: string } | null }>(asWorker)) {
      const title = x.tasks?.title ?? "Task";
      if (x.status === "released") {
        events.push({
          id: "w-" + x.id, kind: "clearing", title: "Earned", meta: title + " · added to your wallet",
          amountMinor: workerShareOfEscrow(x.escrow_minor), incoming: true, at: x.updated_at,
        });
      } else if (x.status === "started" || x.status === "assigned") {
        events.push({
          id: "w-" + x.id, kind: "incoming", title: "Coming to you",
          meta: title + (x.status === "started" ? " · in progress" : " · not started yet"),
          amountMinor: workerShareOfEscrow(x.escrow_minor), incoming: false, at: x.updated_at,
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
        events.push({ id: "r-" + t.id, kind: "topup", title: "Returned to your wallet", meta: t.title + " · not completed, full refund", amountMinor: paid, incoming: true, at: t.wallet_refunded_at });
      }
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

  listPayouts: async (ctx, a) =>
    rows(await ctx.db.from("payouts").select("*").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(limit(a, "limit", 20))),

  listPayoutDestinations: async (ctx) =>
    rows(
      await ctx.db.from("payout_destinations").select("*").eq("user_id", ctx.userId)
        .order("is_default", { ascending: false }).order("created_at", { ascending: false }),
    ),

  listPromotions: async (ctx) =>
    rows(await ctx.db.from("task_promotions").select("*").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(20)),

  /** The live ad auction's running order: { [taskId]: rank }. Rank 1 wins. */
  adAuctionRanks: async (ctx) => {
    const res = await ctx.db.rpc("ad_auction");
    if (res.error) return {};
    const out: Record<string, number> = {};
    for (const r of (res.data ?? []) as { task_id: string; rank: number | null }[]) out[r.task_id] = Number(r.rank ?? 0);
    return out;
  },

  /** The live fee settings, with the defaults when a key is missing. */
  platformFees: async (ctx) => {
    const res = await ctx.db.from("settings").select("key,value")
      .in("key", ["worker_commission_pct", "poster_service_fee_pct", "clearing_period_days", "post_start_cancel_penalty_pct"]);
    const list = (res.data ?? []) as { key: string; value: unknown }[];
    const get = (k: string, d: number) => {
      const v = Number(list.find((r) => r.key === k)?.value);
      return Number.isFinite(v) ? v : d;
    };
    return {
      commission: get("worker_commission_pct", FEES.WORKER_COMMISSION_PCT),
      posterFee: get("poster_service_fee_pct", FEES.POSTER_SERVICE_FEE_PCT),
      clearingDays: get("clearing_period_days", 7),
      // The Terms point at How fees work for this one too.
      cancelFine: get("post_start_cancel_penalty_pct", FEES.POST_START_CANCEL_PENALTY_PCT),
    };
  },

  /** Platform fees the caller actually paid since a date, from the rows that moved the money. */
  feesSince: async (ctx, a) => {
    const iso = isoOrNull(a, "since") ?? "1970-01-01T00:00:00Z";
    const commission = num(a, "commission", 0, 1);
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
  trendingCategories: rpcOp("trending_categories", (a) => ({ p_limit: limit(a, "limit", 8, 50) })),
  topEarners: rpcOp("top_earners", (a) => ({
    p_kind: oneOf(a, "kind", ["top_rated", "most_active", "new_talent"]),
    p_limit: limit(a, "limit", 10, 50),
  })),

  // ----------------------------------------------------- attention & inbox ----
  /** How many things are waiting on the caller right now, for one side. */
  countNeedsAttention: async (ctx, a) => {
    if (oneOf(a, "mode", ["poster", "worker"]) === "poster") {
      const mine = rows<{ id: string; status: string }>(await ctx.db.from("tasks").select("id,status").eq("poster_id", ctx.userId));
      let count = mine.filter((t) => t.status === "WORK_DONE").length; // waiting on them to release
      const open = mine.filter((t) => t.status === "OPEN").map((t) => t.id);
      if (open.length) {
        const quoted = new Set(rows<{ task_id: string }>(await ctx.db.from("bids").select("task_id").in("task_id", open)).map((b) => b.task_id));
        count += open.filter((id) => quoted.has(id)).length; // quotes arrived on something open
      }
      return count;
    }
    const list = rows<{ tasks: { status?: string } | null }>(
      await ctx.db.from("assignments").select("status, tasks(status)").eq("worker_id", ctx.userId).in("status", ["assigned", "started"]),
    );
    return list.filter((x) => x.tasks?.status === "LOCKED").length; // picked but not started
  },

  /** Every conversation the caller is part of, newest first. A thread exists from the hire, not the first message. */
  listThreads: async (ctx) => {
    const LIVE = [...IN_PROGRESS];
    const [msgRes, postedRes, hiredRes] = await Promise.all([
      ctx.db.from("messages").select("*").order("created_at", { ascending: false }).limit(300),
      ctx.db.from("tasks").select("id,title,status,updated_at").eq("poster_id", ctx.userId).in("status", LIVE),
      ctx.db.from("assignments").select("task_id").eq("worker_id", ctx.userId).in("status", ["assigned", "started"]),
    ]);
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
    return [...ids]
      .map((id) => {
        const m = latest.get(id);
        const t = byId.get(id);
        return {
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

  /** A task's thread, oldest first; with `after`, only messages newer than it. */
  listMessages: async (ctx, a) => {
    let q = ctx.db.from("messages").select("*").eq("task_id", uuid(a, "taskId"));
    const after = isoOrNull(a, "after");
    if (after) q = q.gt("created_at", after);
    return rows(await q.order("created_at"));
  },

  /** The other side's phone number, once the work has started; null for none. */
  taskContactPhone: async (ctx, a) => {
    const data = take(await ctx.db.rpc("task_contact_phone", { p_task_id: uuid(a, "taskId") }));
    return typeof data === "string" && data ? data : null;
  },

  // ------------------------------------------------------- notifications ----
  listNotifications: async (ctx, a) =>
    rows(await ctx.db.from("notifications").select("*").eq("user_id", ctx.userId).order("created_at", { ascending: false }).limit(limit(a, "limit", 50))),

  getNotification: async (ctx, a) =>
    take(await ctx.db.from("notifications").select("*").eq("id", uuid(a, "id")).eq("user_id", ctx.userId).maybeSingle()),

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
    const res = await ctx.db.from("notifications").select("id,task_id").eq("user_id", ctx.userId).is("read_at", null).limit(200);
    if (res.error || !res.data) return 0;
    const items = res.data as { id: string; task_id: string | null }[];
    const sides = await sidesFor(ctx, items);
    return items.filter((n) => sides[n.id] === side || sides[n.id] === "both").length;
  },

  // ------------------------------------------------------- support & more ----
  listTickets: async (ctx) =>
    rows(await ctx.db.from("support_tickets").select("*").eq("user_id", ctx.userId).order("updated_at", { ascending: false })),

  getTicket: async (ctx, a) => {
    const id = uuid(a, "ticketId");
    const ticket = take(await ctx.db.from("support_tickets").select("*").eq("id", id).maybeSingle());
    if (!ticket) return null;
    return { ticket, messages: rows(await ctx.db.from("support_messages").select("*").eq("ticket_id", id).order("created_at")) };
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
    const res = await ctx.db.from("tasks").select("id, poster_id").in("id", taskIds);
    for (const t of (res.data ?? []) as { id: string; poster_id: string }[]) owner.set(t.id, t.poster_id);
  }
  const out: Record<string, string> = {};
  for (const r of items) out[r.id] = !r.task_id ? "both" : owner.get(r.task_id) === ctx.userId ? "poster" : "worker";
  return out;
}
