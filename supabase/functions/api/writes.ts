import {
  type Args, type DbError, type Op, MONEY_MAX, OpError, bad, bool, int, isoOrNull, nowIso, numOrNull, oneOf,
  rows, rpcOp, str, strOrNull, strings, take, toOpError, uuid, uuidOrNull, uuids,
} from "./core.ts";

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
  createTask: async ({ db, userId }, a) => {
    const media = a.media as { kind?: unknown; path?: unknown; seconds?: unknown } | null | undefined;
    if (
      media != null &&
      (typeof media !== "object" || !["image", "video"].includes(String(media.kind)) ||
        typeof media.path !== "string" || !media.path.startsWith(`${userId}/`))
    ) {
      throw bad("media");
    }
    const milestones = a.milestones ?? [];
    if (!Array.isArray(milestones) || milestones.length > 50) throw bad("milestones");
    const row = {
      poster_id: userId,
      pillar: str(a, "pillar", 40),
      title: str(a, "title", 300),
      description: description(a),
      benchmark_minor: int(a, "benchmarkMinor", 0, MONEY_MAX),
      time_limit_minutes: int(a, "timeLimitMinutes", 0, 10_000_000),
      flag: oneOf(a, "flag", ["none", "urgent", "unique"], "none"),
      media_kind: media?.kind ?? null,
      media_path: media?.path ?? null,
      media_seconds: typeof media?.seconds === "number" ? media.seconds : null,
      loc_label: strOrNull(a, "locLabel", 200),
      loc_lat: numOrNull(a, "locLat"),
      loc_lng: numOrNull(a, "locLng"),
      category: strOrNull(a, "category", 100),
      skills: strings(a, "skills"),
      difficulty: a.difficulty == null ? null : oneOf(a, "difficulty", ["easy", "medium", "hard"]),
      assignment_mode: oneOf(a, "assignmentMode", ["bids", "auto"], "bids"),
      due_at: isoOrNull(a, "dueAt"),
      milestones,
      kind: oneOf(a, "kind", ["request", "service"], "request"),
    };
    return rows(await db.from("tasks").insert(row).select())[0] ?? null;
  },

  updateListing: async ({ db }, a) => {
    const row = rows(
      await db
        .from("tasks")
        .update({
          title: str(a, "title", 300),
          description: description(a),
          benchmark_minor: int(a, "priceMinor", 0, MONEY_MAX),
          time_limit_minutes: int(a, "deliveryDays", 0, 3650) * 1440,
          category: strOrNull(a, "category", 100),
          loc_label: strOrNull(a, "locLabel", 200),
          loc_lat: numOrNull(a, "locLat"),
          loc_lng: numOrNull(a, "locLng"),
        })
        .eq("id", uuid(a, "id"))
        .eq("kind", "service")
        .select(),
    )[0];
    if (!row) throw new OpError("This service can no longer be edited", "NOT_FOUND");
    return row;
  },

  placeBid: async ({ db, userId }, a) => {
    return rows(
      await db
        .from("bids")
        .insert({
          task_id: uuid(a, "taskId"),
          worker_id: userId,
          price_minor: int(a, "priceMinor", 0, MONEY_MAX),
          time_limit_minutes: int(a, "timeLimitMinutes", 0, 10_000_000),
          message: strOrNull(a, "message", 2000),
        })
        .select(),
      quoteRefusal,
    )[0] ?? null;
  },

  updateBid: async ({ db }, a) => {
    const row = rows(
      await db
        .from("bids")
        .update({
          price_minor: int(a, "priceMinor", 0, MONEY_MAX),
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

  submitProof: async ({ db, userId }, a) => {
    const files = a.files ?? [];
    if (
      !Array.isArray(files) || files.length > 30 ||
      files.some((f) => !f || typeof f !== "object" || typeof (f as { path?: unknown }).path !== "string")
    ) {
      throw bad("files");
    }
    return rows(
      await db
        .from("task_proofs")
        .insert({ task_id: uuid(a, "taskId"), worker_id: userId, summary: str(a, "summary", 5000, 0), files })
        .select(),
    )[0] ?? null;
  },

  sendMessage: async ({ db, userId }, a) => {
    return take(
      await db
        .from("messages")
        .insert({ task_id: uuid(a, "taskId"), sender_id: userId, body: str(a, "body", 10000) })
        .select()
        .single(),
    );
  },

  // ---- profile ----
  /** The setup/profile screen's fields. Only these columns, only your own row. */
  updateProfile: async (ctx, a) => {
    const patch: Record<string, unknown> = {};
    if (a.displayName !== undefined) patch.display_name = str(a, "displayName", 80);
    if (a.skills !== undefined) patch.skills = strings(a, "skills");
    if (a.locLabel !== undefined) patch.loc_label = strOrNull(a, "locLabel", 200);
    if (a.locLat !== undefined) patch.loc_lat = numOrNull(a, "locLat");
    if (a.locLng !== undefined) patch.loc_lng = numOrNull(a, "locLng");
    if (a.avatarUrl !== undefined) patch.avatar_url = strOrNull(a, "avatarUrl", 500);
    if (a.payoutUpi !== undefined) patch.payout_upi = strOrNull(a, "payoutUpi", 100);
    if (bool(a, "onboarded")) patch.onboarded_at = nowIso(ctx);
    const row = rows(await ctx.db.from("profiles").update(patch).eq("id", ctx.userId).select(), profileRefusal)[0];
    if (!row) throw new OpError("Could not save your profile", "NOT_FOUND");
    return row;
  },

  updateProfileExtras: async (ctx, a) => {
    const patch: Record<string, unknown> = {};
    if (a.username !== undefined) {
      const u = strOrNull(a, "username", 40);
      patch.username = u ? u.toLowerCase() : null;
    }
    if (a.bio !== undefined) patch.bio = strOrNull(a, "bio", 2000);
    if (a.workerBio !== undefined) patch.worker_bio = strOrNull(a, "workerBio", 2000);
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

  registerPushToken: rpcOp("register_push_token", (a) => ({
    p_token: str(a, "token", 300),
    p_platform: oneOf(a, "platform", ["ios", "android", "web", "windows", "macos"]),
  })),

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
