import {
  type Args, type Ctx, type DbError, type Op, MONEY_MAX, OpError, bad, bool, coordOrNull, int, isoOrNull, nowIso, numOrNull, oneOf, priceMinor,
  rows, rpcOp, str, strOrNull, strings, take, toOpError, uuid, uuidOrNull, uuids,
} from "./core.ts";
import { assertOwnImage, isMediaRef } from "./media.ts";
import { readFees } from "./reads.ts";
import { roughPlace } from "../_shared/place.ts";
import { PRICE_LIMITS } from "../_shared/rules.ts";
import { contactIssueMessage, findContactIssue, maskContacts, nameCarriesContact, profileIssueMessage } from "../_shared/contacts.ts";

/**
 * Everything that changes something. The caller's id always comes from their
 * session (ctx.userId), never from a field the app sends.
 */

/** A refused quote, in words a worker can act on. */
function quoteRefusal(err: DbError): OpError {
  const raw = err.message ?? "";
  if (/duplicate|unique/i.test(raw)) return new OpError("You have already sent an offer for this task", "DUPLICATE");
  if (/row-level security|violates.*policy/i.test(raw)) {
    return new OpError(
      "You cannot send an offer for this one — it is either your own request, or it is no longer open.",
      "DENIED",
    );
  }
  return toOpError(err);
}

/** A refused profile save, with the two cases a person can fix themselves. */
function profileRefusal(err: DbError): OpError {
  const raw = err.message ?? "";
  if (/profiles_username_key|duplicate/i.test(raw)) return new OpError("That username is taken", "DUPLICATE");
  if (/profiles_username_format/i.test(raw)) {
    return new OpError("Usernames are 3–20 characters: lowercase letters, numbers and _", "BAD_ARGS");
  }
  return toOpError(err);
}

/**
 * Contact details stay inside TaskDrop until the work starts. The app hides or
 * refuses them as they are typed; these checks are the same rules on the
 * server, so a request sent straight to the API cannot skip them. The wording
 * and the patterns come from _shared/contacts.ts (a copy of the app's, kept in
 * step by contacts.test.ts).
 */
const CONTACT_CODE = "CONTACT_DETAILS";

/** A post, a service or a bio: any contact detail or address is refused, with the reason. */
function refuseContacts(text: unknown, wording: "post" | "profile" = "post"): void {
  if (typeof text !== "string" || text === "") return;
  const issue = findContactIssue(text);
  if (issue) throw new OpError(wording === "profile" ? profileIssueMessage(issue) : contactIssueMessage(issue), CONTACT_CODE);
}

/** A quote, a proof summary or a worker bio: anything the app would have hidden is refused. */
function refuseHiddenContacts(text: unknown): void {
  if (typeof text !== "string" || text === "") return;
  if (maskContacts(text).masked) {
    throw new OpError("Phone numbers, emails, links and chat handles can’t be shared here. They are shared automatically once a task starts.", CONTACT_CODE);
  }
}

/** A name or username is shown to strangers, so it must not smuggle a number or an email out. */
function refuseContactInName(name: unknown): void {
  if (typeof name === "string" && nameCarriesContact(name)) {
    throw new OpError("A name can’t contain a phone number or an email address.", CONTACT_CODE);
  }
}

/** Statuses from which contacts are open to both sides in chat (the same list the chat screen uses). */
const CONTACTS_OPEN = ["TASK_STARTED", "OVERDUE", "WORK_DONE", "REVISION_REQUESTED", "COMPLETED", "AUTO_COMPLETED", "DISPUTED"];

const PUSH_PLATFORMS = ["ios", "android", "web", "windows", "macos"] as const;
const INSTALL_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Note which install this call came from (migration 092): platform and app
 * version from the request headers, the rest from the app. The headers win
 * over the arguments, so an old build that sends neither still records what
 * it says about itself.
 */
async function noteDevice(ctx: Ctx, a: Args, push: boolean) {
  const installId = str(a, "installId", 64, 8);
  if (!INSTALL_ID.test(installId)) throw bad("installId");
  const platform = ctx.client?.platform ?? oneOf(a, "platform", PUSH_PLATFORMS);
  take(await ctx.db.rpc("record_device", {
    p_install_id: installId,
    p_platform: platform,
    p_app_version: ctx.client?.appVersion ?? strOrNull(a, "appVersion", 32),
    p_os_version: strOrNull(a, "osVersion", 64),
    p_push: push,
  }));
}

/** Names that would pass for the team or the product. Found 2026-10-24: "admin", "support" and "taskdrop" were all free to take. */
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "support", "help", "taskdrop", "task_drop", "team", "staff", "moderator", "mod", "official",
  "system", "root", "security", "billing", "payments", "payment", "wallet", "careers", "legal", "privacy", "terms",
]);

/** A deadline, or null. Not already past (a few minutes of clock difference are allowed), and not years away. */
function dueAtOrNull(a: Args): string | null {
  const iso = isoOrNull(a, "dueAt");
  if (iso === null) return null;
  const t = Date.parse(iso);
  if (t < Date.now() - 5 * 60_000 || t > Date.now() + 3 * 365 * 86_400_000) throw bad("dueAt");
  return iso;
}

/**
 * A place typed with a door number ("Flat 402, Test Towers, Madhapur, Hyderabad") is two things: the area, which
 * anyone may see, and the line itself, which only the poster and the person hired may. The label that goes into
 * the public column is the area; the full line goes to the owner-only table (migration 126). Found 2026-10-24:
 * the whole line was public to every signed-in person and only the screens hid it.
 */
export function splitPlace(raw: string | null): { label: string | null; address: string | null } {
  if (raw === null) return { label: null, address: null };
  const area = roughPlace(raw);
  return { label: area, address: area === raw ? null : raw };
}

/** Keep the typed address in the owner-only table. Best-effort: the task is already saved with only its area public. */
async function keepAddress(ctx: Ctx, taskId: unknown, address: string | null): Promise<void> {
  if (typeof taskId !== "string") return;
  await ctx.db.rpc("set_task_address", { p_task_id: taskId, p_address: address });
}

const taskOnly = (a: Args) => ({ p_task_id: uuid(a, "taskId") });
const description = (a: Args) => (typeof a.description === "string" ? a.description.slice(0, 20000) : "");

export const WRITE_OPS: Record<string, Op> = {
  // ---- the task lifecycle, where money moves (all decided in SQL) ----
  lockBid: rpcOp("lock_bid", (a) => ({
    p_bid_id: uuid(a, "bidId"),
    p_payout_mode: oneOf(a, "payoutMode", ["one_time", "milestones"], "one_time"),
  })),
  payTaskFromWallet: rpcOp("pay_task_from_wallet", taskOnly),
  startTask: rpcOp("start_task", taskOnly),
  markWorkDone: rpcOp("mark_work_done", taskOnly),
  confirmRelease: rpcOp("confirm_release", taskOnly),
  requestRevision: rpcOp("request_revision", (a) => ({ ...taskOnly(a), p_note: strOrNull(a, "note", 2000) })),
  cancelTask: rpcOp("cancel_task", (a) => ({ ...taskOnly(a), p_reason: strOrNull(a, "reason", 2000) })),
  openDispute: rpcOp("open_dispute", (a) => ({ ...taskOnly(a), p_reason: strOrNull(a, "reason", 2000) })),
  submitReview: rpcOp("submit_review", (a) => ({
    ...taskOnly(a),
    p_rating: int(a, "rating", 1, 5),
    p_comment: strOrNull(a, "comment", 2000),
  })),
  removeListing: async ({ db }, a) => {
    take(await db.rpc("remove_listing", taskOnly(a)));
    return null;
  },

  // ---- earnings and payouts ----
  settleClearedEarnings: rpcOp("settle_my_cleared_earnings"),

  /**
   * The request and the debit happen in one locked SQL transaction; the bank
   * transfer is then handed to RazorpayX straight away. If that hand-off fails
   * the request simply waits for an admin -- it is never lost.
   */
  requestWithdrawal: async (ctx, a) => {
    const row = take<{ id: string }>(await ctx.db.rpc("request_withdrawal", {
      p_amount_minor: int(a, "amountMinor", 1, MONEY_MAX),
      p_destination: strOrNull(a, "destination", 200),
      p_destination_id: uuidOrNull(a, "destinationId"),
    }));
    if (row?.id && ctx.callFunction) await ctx.callFunction("razorpayx-payouts", { action: "send", payoutId: row.id });
    return row;
  },
  cancelWithdrawal: rpcOp("cancel_withdrawal", (a) => ({ p_payout_id: uuid(a, "payoutId") })),
  setDefaultPayoutDestination: rpcOp("set_default_payout_destination", (a) => ({
    p_destination_id: uuid(a, "destinationId"),
  })),

  addPayoutDestination: async ({ db, userId }, a) => {
    const kind = oneOf(a, "kind", ["upi", "bank"]);
    const row = {
      user_id: userId,
      kind,
      label: strOrNull(a, "label", 60) ?? (kind === "upi" ? "UPI" : "Bank"),
      upi_id: kind === "upi" ? str(a, "upiId", 100) : null,
      account_name: kind === "bank" ? str(a, "accountName", 100) : null,
      account_number: kind === "bank" ? str(a, "accountNumber", 40) : null,
      // IFSC is always upper case; storing lower case breaks the format check for no reason.
      ifsc: kind === "bank" ? str(a, "ifsc", 20).toUpperCase() : null,
    };
    return rows(await db.from("payout_destinations").insert(row).select())[0] ?? null;
  },
  removePayoutDestination: async ({ db, userId }, a) => {
    take(await db.from("payout_destinations").delete().eq("id", uuid(a, "id")).eq("user_id", userId).select());
    return null;
  },

  // ---- promotions and ads ----
  startPromotion: rpcOp("start_promotion", (a) => ({
    ...taskOnly(a),
    p_days: int(a, "days", 1, 30),
    p_amount_minor: int(a, "amountMinor", 1, MONEY_MAX),
  })),
  activatePromotion: rpcOp("activate_promotion", (a) => ({
    p_promotion_id: uuid(a, "promotionId"),
    p_payment_id: uuid(a, "paymentId"),
  })),
  cancelPromotion: rpcOp("cancel_promotion", (a) => ({ p_promotion_id: uuid(a, "promotionId") })),
  /** Best-effort: a feed that renders must not fail because delivery could not be logged. */
  recordAdImpression: async ({ db }, a) => {
    await db.rpc("record_ad_impression", taskOnly(a));
    return null;
  },
  recordAdClick: async ({ db }, a) => {
    await db.rpc("record_ad_click", taskOnly(a));
    return null;
  },

  // ---- posts, quotes, proof and chat ----
  createTask: async (ctx, a) => {
    const { db, userId } = ctx;
    const media = a.media as { kind?: unknown; path?: unknown; seconds?: unknown } | null | undefined;
    if (
      media != null &&
      (typeof media !== "object" || !["image", "video"].includes(String(media.kind)) ||
        typeof media.path !== "string" || !(isMediaRef(media.path) || media.path.startsWith(`${userId}/`)))
    ) {
      throw bad("media");
    }
    // A picture in ImageKit is a "media:<id>" reference, and must be the poster's own finished upload.
    if (media != null && isMediaRef(media.path)) await assertOwnImage(ctx, media.path, ["task"]);
    const milestones = a.milestones ?? [];
    if (!Array.isArray(milestones) || milestones.length > 50) throw bad("milestones");
    refuseContacts(a.title);
    refuseContacts(description(a));
    const place = splitPlace(strOrNull(a, "locLabel", 200));
    const row = {
      poster_id: userId,
      pillar: str(a, "pillar", 40),
      title: str(a, "title", 300),
      description: description(a),
      // A request needs at least the smallest amount; a service listing may say "from 0" while it is being set up.
      benchmark_minor: a.kind === "service" ? int(a, "benchmarkMinor", 0, MONEY_MAX) : priceMinor(a, "benchmarkMinor", PRICE_LIMITS.MIN_MINOR),
      time_limit_minutes: int(a, "timeLimitMinutes", 0, 10_000_000),
      flag: oneOf(a, "flag", ["none", "urgent", "unique"], "none"),
      media_kind: media?.kind ?? null,
      media_path: media?.path ?? null,
      media_seconds: typeof media?.seconds === "number" ? media.seconds : null,
      loc_label: place.label,
      loc_lat: coordOrNull(a, "locLat", 90),
      loc_lng: coordOrNull(a, "locLng", 180),
      category: strOrNull(a, "category", 100),
      skills: strings(a, "skills"),
      difficulty: a.difficulty == null ? null : oneOf(a, "difficulty", ["easy", "medium", "hard"]),
      assignment_mode: oneOf(a, "assignmentMode", ["bids", "auto"], "bids"),
      due_at: dueAtOrNull(a),
      milestones,
      kind: oneOf(a, "kind", ["request", "service"], "request"),
    };
    // Auto-hire accepts an offer the moment it arrives and pays for it from the
    // poster's wallet, so a poster who cannot cover it cannot post one. Said in
    // the same words lockBid uses, so the app offers the same "add money" step.
    if (row.assignment_mode === "auto") {
      const { posterFee } = await readFees(ctx);
      const need = Math.round(row.benchmark_minor * (1 + posterFee));
      const wallet = take<{ balance_minor?: number } | null>(
        await db.from("wallets").select("balance_minor").eq("user_id", userId).maybeSingle(),
      );
      const short = need - Number(wallet?.balance_minor ?? 0);
      if (short > 0) throw new OpError("Not enough money in your wallet", "WALLET_SHORT", String(short));
    }
    const made = rows(await db.from("tasks").insert(row).select())[0] ?? null;
    if (made && place.address) await keepAddress(ctx, (made as { id?: unknown }).id, place.address);
    return made;
  },

  updateListing: async (ctx, a) => {
    const { db } = ctx;
    const place = splitPlace(strOrNull(a, "locLabel", 200));
    refuseContacts(a.title);
    refuseContacts(description(a));
    const row = rows(
      await db
        .from("tasks")
        .update({
          title: str(a, "title", 300),
          description: description(a),
          benchmark_minor: int(a, "priceMinor", 0, MONEY_MAX),
          time_limit_minutes: int(a, "deliveryDays", 0, 3650) * 1440,
          category: strOrNull(a, "category", 100),
          loc_label: place.label,
          loc_lat: coordOrNull(a, "locLat", 90),
          loc_lng: coordOrNull(a, "locLng", 180),
        })
        .eq("id", uuid(a, "id"))
        .eq("kind", "service")
        .select(),
    )[0];
    if (!row) throw new OpError("This service can no longer be edited", "NOT_FOUND");
    await keepAddress(ctx, (row as { id?: unknown }).id, place.address);
    return row;
  },

  placeBid: async ({ db, userId }, a) => {
    refuseHiddenContacts(a.message);
    return rows(
      await db
        .from("bids")
        .insert({
          task_id: uuid(a, "taskId"),
          worker_id: userId,
          price_minor: priceMinor(a, "priceMinor", PRICE_LIMITS.MIN_MINOR),
          time_limit_minutes: int(a, "timeLimitMinutes", 0, 10_000_000),
          message: strOrNull(a, "message", 2000),
        })
        .select(),
      quoteRefusal,
    )[0] ?? null;
  },

  updateBid: async ({ db }, a) => {
    refuseHiddenContacts(a.message);
    const row = rows(
      await db
        .from("bids")
        .update({
          price_minor: priceMinor(a, "priceMinor", PRICE_LIMITS.MIN_MINOR),
          time_limit_minutes: int(a, "timeLimitMinutes", 0, 10_000_000),
          message: strOrNull(a, "message", 2000),
        })
        .eq("id", uuid(a, "bidId"))
        .eq("is_locked", false)
        .select(),
      quoteRefusal,
    )[0];
    if (!row) throw new OpError("This offer was already accepted, so it can no longer be changed", "LOCKED");
    return row;
  },

  submitProof: async (ctx, a) => {
    const { db, userId } = ctx;
    const files = a.files ?? [];
    if (
      !Array.isArray(files) || files.length > 30 ||
      files.some((f) => !f || typeof f !== "object" || typeof (f as { path?: unknown }).path !== "string")
    ) {
      throw bad("files");
    }
    for (const f of files as { path: string }[]) {
      if (isMediaRef(f.path)) await assertOwnImage(ctx, f.path, ["proof"]);
    }
    refuseHiddenContacts(a.summary);
    // The table wants at least 10 characters; say so in words instead of "check what you entered" (P2-40).
    if (typeof a.summary !== "string" || a.summary.trim().length < 10) {
      throw new OpError("Write at least 10 characters about what you did", "BAD_ARGS");
    }
    return rows(
      await db
        .from("task_proofs")
        .insert({ task_id: uuid(a, "taskId"), worker_id: userId, summary: str(a, "summary", 5000, 0), files })
        .select(),
    )[0] ?? null;
  },

  sendMessage: async (ctx, a) => {
    const { db, userId } = ctx;
    const body = str(a, "body", 10000);
    // A chat photo kept in ImageKit is "::media::media:<id>", and must be the sender's own.
    if (body.startsWith("::media::media:")) await assertOwnImage(ctx, body.slice("::media::".length), ["chat"]);
    // Until the work starts, contact details stay inside TaskDrop. The task is only looked up when the text needs it.
    if (!body.startsWith("::media::") && findContactIssue(body)) {
      const t = rows(await db.from("tasks").select("status").eq("id", uuid(a, "taskId")))[0] as { status?: string } | undefined;
      if (!t?.status || !CONTACTS_OPEN.includes(t.status)) {
        throw new OpError(
          "Phone numbers, emails, links, chat handles and addresses can’t be shared until the work starts. Keep talking here — it keeps your payment protected.",
          CONTACT_CODE,
        );
      }
    }
    return take(
      await db
        .from("messages")
        .insert({ task_id: uuid(a, "taskId"), sender_id: userId, body })
        .select()
        .single(),
    );
  },

  // ---- profile ----
  /** The setup/profile screen's fields. Only these columns, only your own row. */
  updateProfile: async (ctx, a) => {
    const patch: Record<string, unknown> = {};
    if (a.displayName !== undefined) {
      refuseContactInName(a.displayName);
      patch.display_name = str(a, "displayName", 80);
    }
    if (a.skills !== undefined) patch.skills = strings(a, "skills");
    // A saved place is public on a profile: the area only, never the door number.
    if (a.locLabel !== undefined) patch.loc_label = splitPlace(strOrNull(a, "locLabel", 200)).label;
    if (a.locLat !== undefined) patch.loc_lat = coordOrNull(a, "locLat", 90);
    if (a.locLng !== undefined) patch.loc_lng = coordOrNull(a, "locLng", 180);
    if (a.avatarUrl !== undefined) {
      patch.avatar_url = strOrNull(a, "avatarUrl", 500);
      if (isMediaRef(patch.avatar_url)) await assertOwnImage(ctx, patch.avatar_url, ["avatar"]);
    }
    // No payoutUpi: migration 073 took the legacy column off the editable list
    // (payout destinations replaced it), so writing it made the whole update fail.
    // A caller that still sends it has the field ignored, like any other unknown one.
    if (bool(a, "onboarded")) patch.onboarded_at = nowIso(ctx);
    const row = rows(await ctx.db.from("profiles").update(patch).eq("id", ctx.userId).select(), profileRefusal)[0];
    if (!row) throw new OpError("Could not save your profile", "NOT_FOUND");
    return row;
  },

  updateProfileExtras: async (ctx, a) => {
    const patch: Record<string, unknown> = {};
    if (a.username !== undefined) {
      const u = strOrNull(a, "username", 40);
      refuseContactInName(u);
      if (u && RESERVED_USERNAMES.has(u.toLowerCase())) throw new OpError("That username is reserved. Pick another.", "DUPLICATE");
      patch.username = u ? u.toLowerCase() : null;
    }
    if (a.bio !== undefined) {
      const bio = strOrNull(a, "bio", 2000);
      refuseContacts(bio, "profile");
      patch.bio = bio;
    }
    if (a.workerBio !== undefined) {
      const workerBio = strOrNull(a, "workerBio", 2000);
      refuseHiddenContacts(workerBio);
      patch.worker_bio = workerBio;
    }
    if (bool(a, "workerOnboarded")) patch.worker_onboarded_at = nowIso(ctx);
    if (a.languages !== undefined) patch.languages = strings(a, "languages", 20, 40);
    if (a.intent !== undefined) patch.intent = a.intent == null ? null : oneOf(a, "intent", ["post", "earn", "both"]);
    const row = rows(await ctx.db.from("profiles").update(patch).eq("id", ctx.userId).select(), profileRefusal)[0];
    if (!row) throw new OpError("Could not save your profile", "NOT_FOUND");
    return row;
  },

  /** "Has TaskDrop open." Best-effort; never fails the caller. */
  touchPresence: async (ctx) => {
    try {
      await ctx.db.from("profiles").update({ last_seen_at: nowIso(ctx) }).eq("id", ctx.userId);
    } catch {
      /* presence is a nicety */
    }
    return null;
  },

  recordBirthDate: rpcOp("record_birth_date", (a) => {
    const v = str(a, "birthDate", 10, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw bad("birthDate");
    return { p_birth_date: v };
  }),

  /**
   * Delete the caller's account (migration 087). The database empties it and
   * signs it out everywhere in one transaction, then hands back the storage
   * paths that no kept record needs; those go with the service role, because
   * the caller's own token stops working the moment the sessions are gone.
   */
  deleteMyAccount: async (ctx, a) => {
    const out = take<{ files?: unknown }>(await ctx.db.rpc("delete_my_account", {
      p_confirm: str(a, "confirm", 40),
    }));
    const files = Array.isArray(out?.files) ? out.files.filter((p): p is string => typeof p === "string") : [];
    if (files.length && ctx.removeOwnFiles) await ctx.removeOwnFiles(files);
    return { deleted: true };
  },

  registerPushToken: async (ctx, a) => {
    take(await ctx.db.rpc("register_push_token", {
      p_token: str(a, "token", 300),
      p_platform: oneOf(a, "platform", PUSH_PLATFORMS),
    }));
    // Which phone this is (platform, app version, OS, last seen). Newer
    // builds say; older ones simply don't, and registering still works.
    if (a.installId != null) {
      try {
        await noteDevice(ctx, a, true);
      } catch {
        /* a device record must never undo a registered token */
      }
    }
    return null;
  },

  /** "This install is on this app version and OS, and was just seen." Once per start-up, on every platform. */
  recordDevice: async (ctx, a) => {
    await noteDevice(ctx, a, bool(a, "push"));
    return null;
  },

  // ---- reports and blocks (migration 093) ----
  /** Tell the team about a person, a task, a message or a review. One open report per person per thing. */
  reportContent: rpcOp("report_content", (a) => ({
    p_type: oneOf(a, "targetType", ["user", "task", "message", "review"]),
    p_target: uuid(a, "targetId"),
    p_reason: str(a, "reason", 500),
  })),
  blockUser: rpcOp("block_user", (a) => ({ p_user: uuid(a, "userId") })),
  unblockUser: rpcOp("unblock_user", (a) => ({ p_user: uuid(a, "userId") })),

  // ---- saved tasks, notifications, feedback, support, referrals ----
  setSaved: async ({ db, userId }, a) => {
    const taskId = uuid(a, "taskId");
    if (bool(a, "saved")) take(await db.from("saved_tasks").upsert({ user_id: userId, task_id: taskId }));
    else take(await db.from("saved_tasks").delete().eq("user_id", userId).eq("task_id", taskId));
    return null;
  },

  markNotificationsRead: async (ctx, a) => {
    const ids = uuids(a, "ids");
    let q = ctx.db.from("notifications").update({ read_at: nowIso(ctx) }).eq("user_id", ctx.userId).is("read_at", null);
    if (ids.length) q = q.in("id", ids);
    take(await q);
    return null;
  },

  sendFeedback: async ({ db, userId }, a) => {
    const body = str(a, "body", 5000, 0);
    if (body.length < 3) throw new OpError("Write a little more first", "BAD_ARGS");
    take(await db.from("feedback").insert({
      user_id: userId,
      kind: oneOf(a, "kind", ["broken", "idea", "confusing", "praise"]),
      body,
      page: strOrNull(a, "page", 200),
    }));
    return null;
  },

  openTicket: rpcOp("open_support_ticket", (a) => ({
    p_category: oneOf(a, "category", ["payment", "task", "account", "safety", "bug", "other"]),
    p_body: str(a, "body", 5000),
    p_page: strOrNull(a, "page", 200),
  })),
  replyTicket: rpcOp("reply_support_ticket", (a) => ({ p_ticket_id: uuid(a, "ticketId"), p_body: str(a, "body", 5000) })),
  resolveTicket: rpcOp("resolve_support_ticket", (a) => ({ p_ticket_id: uuid(a, "ticketId") })),
  applyReferralCode: rpcOp("apply_referral_code", (a) => ({ p_code: str(a, "code", 40) })),
};
