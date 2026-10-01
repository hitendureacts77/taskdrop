/**
 * RazorpayX payouts for TaskDrop: sending a worker's withdrawal, asking
 * RazorpayX where one stands, and reading its webhook.
 *
 * The one rule this file keeps: a withdrawal is never paid twice and never
 * lost. That rests on three things.
 *
 *   1. Every attempt for a withdrawal sends the SAME body with the SAME
 *      X-Payout-Idempotency key (the withdrawal's own id), so RazorpayX answers
 *      a retry with the payout it already made instead of making another.
 *   2. Once an attempt starts, the withdrawal never goes back to "requested",
 *      where the worker could cancel it (migration 066). An attempt with no
 *      clear answer is simply tried again later.
 *   3. Money goes back to the worker only on RazorpayX's word: a final status
 *      (failed / rejected / cancelled / reversed), or RazorpayX confirming it
 *      has no payout under this withdrawal's reference. A refusal alone is not
 *      enough, because a refused retry can sit next to an accepted first try.
 *
 * Every decision about money is made in Postgres (record_payout_status,
 * fail_unsent_payout); this file talks to RazorpayX and reports what it said.
 *
 * API used (https://razorpay.com/docs/api/x/):
 *   POST /v1/contacts                 the worker, deduplicated by RazorpayX
 *   POST /v1/fund_accounts            their bank account or UPI ID, deduplicated
 *   POST /v1/payouts                  with X-Payout-Idempotency (mandatory)
 *   GET  /v1/payouts/:id              one payout's status
 *   GET  /v1/payouts?reference_id=    is there a payout for this withdrawal?
 *   GET  /v1/transactions?count=1     the account balance after the last entry
 */

// deno-lint-ignore no-explicit-any
type Db = any;

export type XConfig = { account: string; keyId: string; keySecret: string };
export type XResult = { ok: boolean; status: number; data: Record<string, unknown> };

const API = "https://api.razorpay.com/v1";
/** At most four calls per attempt, each cut off here: under the 2-minute claim. */
const CALL_TIMEOUT_MS = 20_000;

/** One RazorpayX call. Never throws: a network failure comes back as status 0. */
export async function x(
  cfg: XConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  idempotencyKey?: string,
): Promise<XResult> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Basic ${btoa(`${cfg.keyId}:${cfg.keySecret}`)}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "X-Payout-Idempotency": idempotencyKey } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Every attempt must finish well inside the 2-minute claim (migration
      // 066), so a slow RazorpayX can never have two attempts in flight at once.
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, status: 0, data: { error: { description: `Could not reach RazorpayX (${(e as Error).message})` } } };
  }
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty or not JSON */
  }
  return { ok: res.ok, status: res.status, data };
}

/** RazorpayX's own words for a failed call. */
export function xError(r: XResult, fallback: string): string {
  const e = r.data?.error as { description?: string; reason?: string } | undefined;
  return e?.description || e?.reason || fallback;
}

/** 4xx: RazorpayX looked at the request and said no. 0 or 5xx: no clear answer. */
const definite = (r: XResult) => r.status >= 400 && r.status < 500;

/**
 * A name RazorpayX accepts for a contact (3-50 characters: letters, digits,
 * spaces and ' - _ / ( ) .). Anything else becomes a space.
 */
export function cleanName(raw: string | null | undefined, max = 50, fallback = "TaskDrop worker"): string {
  const s = String(raw ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // accents off: é -> e
    .replace(/[^A-Za-z0-9 '\-_/().]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
  return s.length >= 3 ? s : fallback;
}

export type PayoutRow = {
  id: string;
  user_id: string;
  amount_minor: number;
  status: "requested" | "processing" | "paid" | "failed" | "cancelled";
  via: string;
  destination_id: string | null;
  provider_payout_id: string | null;
  provider_status: string | null;
  provider_status_at: string | null;
  last_attempt_at: string | null;
  attempts: number;
  failure_note: string | null;
  reference: string | null;
};

type Destination = {
  id: string;
  user_id: string;
  kind: "upi" | "bank";
  upi_id: string | null;
  account_name: string | null;
  account_number: string | null;
  ifsc: string | null;
  rzp_contact_id: string | null;
  rzp_fund_account_id: string | null;
};

/** RazorpayX's payout, as far as we use it. */
export type XPayout = {
  id: string;
  status?: string;
  utr?: string | null;
  fees?: number | null;
  tax?: number | null;
  mode?: string | null;
  reference_id?: string | null;
  failure_reason?: string | null;
  status_details?: { description?: string | null; reason?: string | null } | null;
};

/** What a caller is told about one withdrawal after we tried or checked it. */
export type Outcome = {
  id: string;
  status: PayoutRow["status"] | "unknown";
  providerStatus?: string | null;
  note?: string | null;
  retryLater?: boolean;
};

const summarise = (row: PayoutRow | null, id: string, extra: Partial<Outcome> = {}): Outcome => ({
  id,
  status: row?.status ?? "unknown",
  providerStatus: row?.provider_status ?? null,
  note: row?.failure_note ?? null,
  ...extra,
});

async function readRow(admin: Db, id: string): Promise<PayoutRow | null> {
  const { data } = await admin.from("payouts").select("*").eq("id", id).maybeSingle();
  return (data as PayoutRow | null) ?? null;
}

/** Write down what RazorpayX says about a withdrawal (safe in any order, any number of times). */
export async function recordPayout(admin: Db, payoutId: string, p: XPayout): Promise<{ row: PayoutRow | null; error?: string }> {
  if (p.mode) {
    await admin.rpc("record_payout_sent", { p_payout_id: payoutId, p_provider_id: p.id, p_mode: p.mode });
  }
  const { data, error } = await admin.rpc("record_payout_status", {
    p_payout_id: payoutId,
    p_provider_id: p.id,
    p_status: p.status ?? null,
    p_utr: p.utr ?? null,
    p_fee_minor: typeof p.fees === "number" ? p.fees : null,
    p_tax_minor: typeof p.tax === "number" ? p.tax : null,
    p_note: p.status_details?.description ?? p.failure_reason ?? null,
  });
  if (error) return { row: null, error: error.message };
  return { row: (data as PayoutRow | null) ?? null };
}

/** Is there a RazorpayX payout for this withdrawal? 'unknown' when RazorpayX can't be asked. */
export async function findByReference(
  cfg: XConfig,
  payoutId: string,
): Promise<{ state: "found"; payout: XPayout } | { state: "none" } | { state: "unknown"; why: string }> {
  const q = new URLSearchParams({ account_number: cfg.account, reference_id: payoutId, count: "10" });
  const r = await x(cfg, "GET", `/payouts?${q.toString()}`);
  if (!r.ok) return { state: "unknown", why: xError(r, "RazorpayX did not answer") };
  const items = ((r.data.items ?? []) as XPayout[]).filter((p) => p.reference_id === payoutId);
  return items.length ? { state: "found", payout: items[0] } : { state: "none" };
}

/**
 * RazorpayX refused something for this withdrawal. Give the money back only if
 * RazorpayX confirms there is no payout for it; otherwise record the payout it
 * has, or leave it to be checked again.
 */
async function refusedOrExisting(admin: Db, cfg: XConfig, row: PayoutRow, why: string): Promise<Outcome> {
  const found = await findByReference(cfg, row.id);
  if (found.state === "found") {
    const { row: after } = await recordPayout(admin, row.id, found.payout);
    return summarise(after, row.id);
  }
  // Only the first attempt may conclude "never sent" on its own. A later one
  // can be refused while an earlier, timed-out attempt is still landing at
  // RazorpayX, so "none yet" is not "none": it waits, and a person gives it
  // back later from the Payouts page (giveBack), by which time it has settled.
  if (found.state === "none" && Number(row.attempts) <= 1) {
    const { data } = await admin.rpc("fail_unsent_payout", {
      p_payout_id: row.id,
      p_note: why,
      p_expected_attempts: Number(row.attempts),
    });
    const after = (data as PayoutRow | null) ?? null;
    if (after && (after.status === "requested" || after.status === "processing")) {
      return summarise(after, row.id, { note: "It was sent again meanwhile; checking with RazorpayX again", retryLater: true });
    }
    return summarise(after, row.id, { note: why });
  }
  await admin.rpc("unclaim_payout", { p_payout_id: row.id, p_note: `${why} (checking again)` });
  return summarise(row, row.id, { status: "processing", note: why, retryLater: true });
}

type FundAccount = { ok: true; id: string } | { ok: false; definite: boolean; why: string };

/** The worker's bank account or UPI ID as a RazorpayX fund account, made once and reused. */
async function fundAccountFor(admin: Db, cfg: XConfig, d: Destination, contactName: string): Promise<FundAccount> {
  if (d.rzp_fund_account_id) return { ok: true, id: d.rzp_fund_account_id };

  let contactId = d.rzp_contact_id;
  if (!contactId) {
    const c = await x(cfg, "POST", "/contacts", {
      name: cleanName(contactName),
      type: "vendor",
      reference_id: d.user_id,
      notes: { taskdrop_user: d.user_id },
    });
    if (!c.ok || !c.data.id) return { ok: false, definite: definite(c), why: xError(c, "RazorpayX did not accept the worker's name") };
    contactId = String(c.data.id);
  }

  const f = await x(
    cfg,
    "POST",
    "/fund_accounts",
    d.kind === "upi"
      ? { contact_id: contactId, account_type: "vpa", vpa: { address: d.upi_id } }
      : {
          contact_id: contactId,
          account_type: "bank_account",
          bank_account: { name: cleanName(d.account_name, 120, contactName), ifsc: d.ifsc, account_number: d.account_number },
        },
  );
  if (!f.ok || !f.data.id) {
    return {
      ok: false,
      definite: definite(f),
      why: xError(f, d.kind === "upi" ? "RazorpayX did not accept this UPI ID" : "RazorpayX did not accept these bank details"),
    };
  }
  const fundId = String(f.data.id);
  // If this write fails the next attempt creates the same fund account again,
  // and RazorpayX hands back the existing one: same id, same payout body.
  const { error } = await admin.rpc("save_payout_fund_account", {
    p_destination_id: d.id,
    p_contact_id: contactId,
    p_fund_account_id: fundId,
  });
  if (error) console.error("fund account not saved", d.id, fundId, error.message);
  return { ok: true, id: fundId };
}

/**
 * Hand one withdrawal to RazorpayX, or try again after an attempt that got no
 * answer. Does nothing to a withdrawal that is not waiting to be sent.
 */
export async function sendPayout(admin: Db, cfg: XConfig, payoutId: string): Promise<Outcome> {
  const { data: claimed, error: claimErr } = await admin.rpc("claim_payout_for_sending", { p_payout_id: payoutId });
  const row = (claimed as PayoutRow | null) ?? null;
  if (claimErr || !row?.id) {
    const now = await readRow(admin, payoutId);
    return summarise(now, payoutId, claimErr ? { note: claimErr.message } : {});
  }

  const { data: dest } = await admin.from("payout_destinations").select("*").eq("id", row.destination_id).maybeSingle();
  if (!dest) {
    return refusedOrExisting(admin, cfg, row, "The bank account or UPI ID for this withdrawal was removed");
  }

  const { data: prof } = await admin.from("payout_profiles").select("legal_name").eq("user_id", row.user_id).maybeSingle();
  let name = (prof?.legal_name as string | undefined) ?? "";
  if (!name) {
    const { data: p2 } = await admin.from("profiles").select("display_name").eq("id", row.user_id).maybeSingle();
    name = (p2?.display_name as string | undefined) ?? "";
  }

  const fund = await fundAccountFor(admin, cfg, dest as Destination, name);
  if (!fund.ok) {
    if (fund.definite) return refusedOrExisting(admin, cfg, row, fund.why);
    await admin.rpc("unclaim_payout", { p_payout_id: row.id, p_note: fund.why });
    return summarise(row, row.id, { status: "processing", note: fund.why, retryLater: true });
  }

  const mode = (dest as Destination).kind === "upi" ? "UPI" : "IMPS";
  // Byte-for-byte the same on every attempt: RazorpayX matches retries on the
  // idempotency key, and the body must not change under it.
  const made = await x(
    cfg,
    "POST",
    "/payouts",
    {
      account_number: cfg.account,
      fund_account_id: fund.id,
      amount: Number(row.amount_minor),
      currency: "INR",
      mode,
      purpose: "payout",
      queue_if_low_balance: true,
      reference_id: row.id,
      narration: "TaskDrop earnings",
      // No notes: a withdrawal first tried by the older (065) function is
      // retried with its exact body, so RazorpayX accepts the same key.
    },
    row.id,
  );

  if (made.ok && made.data.id) {
    const { row: after, error } = await recordPayout(admin, row.id, { ...(made.data as XPayout), mode });
    if (error) console.error("PAYOUT MADE BUT NOT RECORDED", row.id, made.data.id, error);
    return summarise(after ?? row, row.id);
  }
  if (definite(made)) return refusedOrExisting(admin, cfg, row, xError(made, "RazorpayX refused the withdrawal"));

  const why = xError(made, "RazorpayX did not answer");
  await admin.rpc("unclaim_payout", { p_payout_id: row.id, p_note: why });
  return summarise(row, row.id, { status: "processing", note: why, retryLater: true });
}

/** Ask RazorpayX where a sent withdrawal stands, and write it down. */
export async function refreshPayout(admin: Db, cfg: XConfig, row: PayoutRow): Promise<Outcome> {
  if (!row.provider_payout_id) return sendPayout(admin, cfg, row.id);
  const r = await x(cfg, "GET", `/payouts/${encodeURIComponent(row.provider_payout_id)}`);
  if (!r.ok || !r.data.id) return summarise(row, row.id, { note: xError(r, "RazorpayX did not answer"), retryLater: true });
  const { row: after } = await recordPayout(admin, row.id, r.data as XPayout);
  return summarise(after ?? row, row.id);
}

const STALE_MS = 5 * 60 * 1000;
const GIVE_BACK_AFTER_MS = 10 * 60 * 1000;

/**
 * Bring open withdrawals up to date: send the ones never sent (or whose last
 * try got no answer), and ask RazorpayX about the ones it has that have not
 * been heard of for five minutes (a missed webhook).
 */
export async function syncOpen(admin: Db, cfg: XConfig, userId: string | null, limit = 50): Promise<Outcome[]> {
  let q = admin
    .from("payouts")
    .select("*")
    .eq("via", "razorpayx")
    .in("status", ["requested", "processing"]);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q.order("created_at", { ascending: true }).limit(limit);
  const out: Outcome[] = [];
  const now = Date.now();
  for (const row of (data ?? []) as PayoutRow[]) {
    if (!row.provider_payout_id) {
      out.push(await sendPayout(admin, cfg, row.id));
      continue;
    }
    const heard = Date.parse(row.provider_status_at ?? row.last_attempt_at ?? "") || 0;
    if (now - heard >= STALE_MS) out.push(await refreshPayout(admin, cfg, row));
    else out.push(summarise(row, row.id));
  }
  return out;
}

/**
 * An admin gives a stuck withdrawal back to the worker. Allowed only when
 * RazorpayX confirms it has no payout for it; otherwise its real status is
 * recorded instead.
 */
export async function giveBack(admin: Db, cfg: XConfig, payoutId: string): Promise<Outcome> {
  const row = await readRow(admin, payoutId);
  if (!row) return { id: payoutId, status: "unknown", note: "That withdrawal does not exist" };
  if (row.status !== "requested" && row.status !== "processing") return summarise(row, row.id);
  if (row.provider_payout_id) return refreshPayout(admin, cfg, row);
  // An attempt that timed out can still land at RazorpayX for a little while.
  const last = Date.parse(row.last_attempt_at ?? "") || 0;
  if (last && Date.now() - last < GIVE_BACK_AFTER_MS) {
    return summarise(row, row.id, {
      note: "It was tried less than 10 minutes ago. Wait a few minutes so RazorpayX has the final word, then try again.",
      retryLater: true,
    });
  }
  const found = await findByReference(cfg, row.id);
  if (found.state === "found") {
    const { row: after } = await recordPayout(admin, row.id, found.payout);
    return summarise(after, row.id, { note: "RazorpayX has this withdrawal, so its own status was recorded" });
  }
  if (found.state === "unknown") return summarise(row, row.id, { note: found.why, retryLater: true });
  // The database refuses if it was sent again since this check, or less than
  // 10 minutes ago, so a retry landing right now can never be paid twice.
  const { data } = await admin.rpc("fail_unsent_payout", {
    p_payout_id: row.id,
    p_note: "Stopped by TaskDrop: it never reached RazorpayX",
    p_expected_attempts: Number(row.attempts),
    p_quiet_minutes: GIVE_BACK_AFTER_MS / 60_000,
  });
  const after = (data as PayoutRow | null) ?? null;
  if (after && (after.status === "requested" || after.status === "processing")) {
    return summarise(after, row.id, {
      note: "It was sent again while we were checking. Nothing was changed; wait 10 minutes and look again.",
      retryLater: true,
    });
  }
  return summarise(after, row.id);
}

/** The RazorpayX account balance, from the running balance on its latest entry. */
export async function balance(cfg: XConfig): Promise<{ ok: boolean; balanceMinor: number | null; asOf: number | null; error?: string }> {
  const q = new URLSearchParams({ account_number: cfg.account, count: "1" });
  const r = await x(cfg, "GET", `/transactions?${q.toString()}`);
  if (!r.ok) return { ok: false, balanceMinor: null, asOf: null, error: xError(r, "RazorpayX did not answer") };
  const item = ((r.data.items ?? []) as { balance?: number; created_at?: number }[])[0];
  return { ok: true, balanceMinor: item ? Number(item.balance ?? 0) : 0, asOf: item?.created_at ?? null };
}

// ------------------------------------------------------------- webhook --

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signatureFor(raw: string, key: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(raw));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One RazorpayX webhook delivery. Returns the HTTP status and body to answer
 * with: 2xx tells RazorpayX to stop, 5xx makes it retry (used when our own
 * write failed, so no update is ever dropped).
 */
export async function handleWebhook(
  admin: Db,
  raw: string,
  signature: string,
  webhookSecret: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!webhookSecret) return { status: 503, body: { error: "Set RAZORPAYX_WEBHOOK_SECRET first", configured: false } };
  if (!signature || !safeEqual(signature, await signatureFor(raw, webhookSecret))) {
    return { status: 401, body: { error: "Bad signature" } };
  }

  let event: { event?: string; payload?: { payout?: { entity?: XPayout } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return { status: 400, body: { error: "Expected JSON" } };
  }

  const p = event.payload?.payout?.entity;
  // Downtime notices and anything that is not a payout: acknowledge.
  if (!p?.id) return { status: 200, body: { ok: true, ignored: event.event ?? null } };

  // RazorpayX's id first; our own id (the reference) for an event that got
  // here before the send was written down.
  let { data: row } = await admin.from("payouts").select("id").eq("provider_payout_id", p.id).maybeSingle();
  if (!row && p.reference_id && UUID.test(p.reference_id)) {
    ({ data: row } = await admin.from("payouts").select("id").eq("id", p.reference_id).maybeSingle());
  }
  // A payout made from the RazorpayX dashboard, not one of ours.
  if (!row) return { status: 200, body: { ok: true, ignored: "not a TaskDrop withdrawal" } };

  // The payout's own status is the truth; the event name only says what changed.
  const status = p.status ?? String(event.event ?? "").replace(/^payout\./, "");
  const { row: after, error } = await recordPayout(admin, row.id as string, { ...p, status });
  if (error) return { status: 500, body: { error } };
  return { status: 200, body: { ok: true, status: after?.status ?? null } };
}
