/**
 * What the Inngest functions actually do, kept free of the Inngest SDK and of
 * Deno so it can be tested with plain Node (see jobs.test.ts).
 *
 * The rule of the house: Postgres owns the rules and the money. Nothing here
 * decides who gets paid or what a price is; it moves events, asks the database
 * to run the sweeps it already has, and leaves messages for the team.
 */

import { deleteFile, type Fetch as ImageKitFetch, findFileId, type ImageKitConfig } from "../_shared/imagekit.ts";

/** The one database call shape these jobs need: supabase.rpc, narrowed. */
export type Rpc = (
  name: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** Calls a database function and throws on error so Inngest retries the step. */
export async function call<T = unknown>(rpc: Rpc, name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

// ------------------------------------------------------------------ outbox --

export type OutboxRow = { id: string; kind: string; data: Record<string, unknown>; created_at: string };

export type OutboundEvent = { id: string; name: string; data: Record<string, unknown> };

/** The outbox id is the Inngest event id, so a re-send is dropped as a duplicate. */
export function toEvents(rows: OutboxRow[]): OutboundEvent[] {
  return rows.map((r) => ({ id: r.id, name: `taskdrop/${r.kind}`, data: r.data ?? {} }));
}

// ------------------------------------------------------------------ alerts --

export type Alert = { kind: string; title: string; body: string };

const rupees = (v: unknown) => `₹${Number(v ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const text = (v: unknown, fallback = "someone") => {
  const s = String(v ?? "").trim();
  return s === "" ? fallback : s;
};

/**
 * Text a person typed, or a provider wrote, that must never be copied into an
 * alert or stored with it. The database no longer puts these in events (090);
 * this is the second lock, for an event that was queued before that change.
 */
const FREE_TEXT_KEYS = ["subject", "reason", "title", "failure_note", "description", "message", "note"];

/** The event's data with free-text fields removed, for storing beside an alert. */
export function safeData(d: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).filter(([k]) => !FREE_TEXT_KEYS.includes(k)));
}

/** What the team should be told about an event, or null if it needs no alert. */
export function alertFor(eventName: string, d: Record<string, unknown>): Alert | null {
  switch (eventName.replace(/^taskdrop\//, "")) {
    case "support.opened":
      return {
        kind: "support",
        title: "New help request",
        body: `${text(d.from)} · ${text(d.category, "other")}. Open Help requests to read it.`,
      };
    case "withdrawal.requested":
      return {
        kind: "withdrawal",
        title: `Withdrawal requested: ${rupees(d.amount_rupees)}`,
        body: `${text(d.name)} via ${text(d.via, "UPI or bank")}`,
      };
    case "payout.failed":
      return {
        kind: "payout_failed",
        title: `Payout failed: ${rupees(d.amount_rupees)}`,
        body: `${text(d.name)}. Open Payouts to see why.`,
      };
    case "dispute.opened":
      return {
        kind: "dispute",
        title: "Dispute opened",
        body: `Poster: ${text(d.poster)}. Open Disputes to decide.`,
      };
    default:
      return null;
  }
}

/** The events that produce an alert, so the function's triggers cannot drift from alertFor. */
export const ALERT_EVENTS = [
  "taskdrop/support.opened",
  "taskdrop/withdrawal.requested",
  "taskdrop/payout.failed",
  "taskdrop/dispute.opened",
] as const;

// ------------------------------------------------------------------ digest --

export type Digest = Record<string, unknown>;

export function digestAlert(d: Digest): Alert {
  const n = (k: string) => Number(d[k] ?? 0);
  return {
    kind: "digest",
    title: `Daily digest, ${text(d.date, "today")}`,
    body: [
      `${n("new_people")} new people (${n("people_total")} in all)`,
      `${n("jobs_posted")} jobs posted, ${n("jobs_finished")} finished`,
      `TaskDrop earned ${rupees(d.earned_rupees)}`,
      `${n("withdrawals_waiting")} withdrawals waiting (${rupees(d.withdrawals_waiting_rupees)})`,
      `${n("open_disputes")} open disputes, ${n("open_help_requests")} open help requests`,
    ].join("\n"),
  };
}

export async function saveAlert(rpc: Rpc, a: Alert, data: Record<string, unknown> = {}): Promise<string> {
  return call<string>(rpc, "record_admin_alert", {
    p_kind: a.kind,
    p_title: a.title,
    p_body: a.body,
    p_data: data,
  });
}

// ----------------------------------------------------------- reconciliation --

/** A payment of ours that has a Razorpay payment link (see reconcile_provider_candidates). */
export type ProviderPayment = { id: string; provider_ref: string; status: string; amount_minor: number; created_at: string };

/** What Razorpay returns for a payment link, narrowed to what we compare. */
export type ProviderLink = { status?: string; amount?: number } | null;

export type ProviderMismatch = { payment: string; ref: string; ours: string; theirs: string; note: string };

/**
 * Whether our record of a payment agrees with Razorpay's payment link.
 * Razorpay amounts are in paise, like ours. A link that is merely expired or
 * cancelled while ours is still "created" is not a disagreement.
 */
export function compareProviderPayment(p: ProviderPayment, link: ProviderLink): ProviderMismatch | null {
  const base = { payment: p.id, ref: p.provider_ref, ours: p.status };
  if (!link) return { ...base, theirs: "not found", note: "Razorpay has no payment link with this id" };
  const theirs = String(link.status ?? "unknown");
  if (theirs === "paid" && p.status !== "paid") {
    return { ...base, theirs, note: "Razorpay says paid but we do not" };
  }
  if (p.status === "paid" && theirs !== "paid") {
    return { ...base, theirs, note: "We say paid but Razorpay does not" };
  }
  if (typeof link.amount === "number" && Number(link.amount) !== Number(p.amount_minor)) {
    return { ...base, theirs, note: "The amount differs: Razorpay " + link.amount + ", ours " + p.amount_minor };
  }
  return null;
}

// -------------------------------------------------------------------- push --

const EXPO = "https://exp.host/--/api/v2/push";
const EXPO_HEADERS = { "Content-Type": "application/json", Accept: "application/json" };

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

/** One message for one device, as the database built it (push_job_load). */
export type PushMessage = { to: string } & Record<string, unknown>;

type ExpoError = { details?: { error?: string } };
export type PushTicket = ({ status?: string; id?: string } & ExpoError) | undefined;
export type PushReceipt = ({ status?: string } & ExpoError) | undefined;

/** A ticket we are waiting on a receipt for; `key` stands in for the device token. */
export type WaitingTicket = { id: string; key: string };

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * A short, one-way stand-in for a device token. Inngest keeps what a step
 * returns, so a step must never hand back a token itself; this lets a receipt
 * be matched to a device later without doing that.
 */
export async function tokenKey(token: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(hash.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hands the messages to Expo. Throws on an HTTP error so Inngest retries the step. */
export async function expoSend(f: Fetch, messages: PushMessage[]): Promise<PushTicket[]> {
  const res = await f(`${EXPO}/send`, { method: "POST", headers: EXPO_HEADERS, body: JSON.stringify(messages) });
  if (!res.ok) throw new Error(`Expo push send: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  return Array.isArray(body?.data) ? (body.data as PushTicket[]) : [];
}

/** Asks Expo how the earlier sends went. Throws on an HTTP error so Inngest retries the step. */
export async function expoReceipts(f: Fetch, ids: string[]): Promise<Record<string, PushReceipt>> {
  const res = await f(`${EXPO}/getReceipts`, { method: "POST", headers: EXPO_HEADERS, body: JSON.stringify({ ids }) });
  if (!res.ok) throw new Error(`Expo push receipts: HTTP ${res.status}`);
  const body = (await res.json()) as { data?: unknown };
  return body?.data && typeof body.data === "object" ? (body.data as Record<string, PushReceipt>) : {};
}

const gone = (r: { details?: { error?: string } } | undefined) => r?.details?.error === "DeviceNotRegistered";

/**
 * Sorts Expo's answer to a send, message by message (the tickets come back in
 * the order the messages went). `dead` are tokens Expo already says are gone.
 */
export async function readTickets(messages: PushMessage[], tickets: PushTicket[]) {
  const waiting: WaitingTicket[] = [];
  const dead: string[] = [];
  let failed = 0;
  for (let i = 0; i < messages.length; i++) {
    const t = tickets[i];
    if (t?.status === "ok" && t.id) waiting.push({ id: t.id, key: await tokenKey(messages[i].to) });
    else if (t?.status === "error" && gone(t)) dead.push(messages[i].to);
    else failed++;
  }
  return { waiting, dead, failed };
}

/** Which of the waiting tickets Expo now says belong to a device that is gone. */
export function deadKeys(waiting: WaitingTicket[], receipts: Record<string, PushReceipt>): string[] {
  return waiting.filter((w) => receipts[w.id]?.status === "error" && gone(receipts[w.id])).map((w) => w.key);
}

/** The tokens, out of a person's current ones, that match the given keys. */
export async function tokensForKeys(tokens: string[], keys: string[]): Promise<string[]> {
  const wanted = new Set(keys);
  const out: string[] = [];
  for (const t of tokens) if (wanted.has(await tokenKey(t))) out.push(t);
  return out;
}

// ---------------------------------------------------------- deleted accounts --

/** Storage removes up to this many files per call. */
export const STORAGE_BATCH = 100;

/** Only paths inside the deleted person's own folder, with no way out of it. */
export function ownFiles(userId: string, paths: unknown): string[] {
  if (!Array.isArray(paths)) return [];
  return paths.filter((p): p is string => typeof p === "string" && p.startsWith(`${userId}/`) && !p.includes(".."));
}

// ------------------------------------------------------------------- people --

/** The three events that describe a person's life, and what the database calls each. */
export const USER_EVENTS = {
  "taskdrop/user.signed_up": "signed_up",
  "taskdrop/user.updated": "updated",
  "taskdrop/user.deleted": "deleted",
} as const;

export type UserSyncArgs = {
  p_user: string;
  p_event: (typeof USER_EVENTS)[keyof typeof USER_EVENTS];
  p_event_id: string | null;
  p_fields: string[];
  p_by_admin: boolean | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What to hand user_sync_apply for a user event, or null when the event does
 * not name a person. Only the person's id, which fields changed (names, never
 * values) and whether an admin did it: that is all such an event carries.
 */
export function userSyncArgs(eventName: string, eventId: string | undefined, d: Record<string, unknown>): UserSyncArgs | null {
  const kind = USER_EVENTS[eventName as keyof typeof USER_EVENTS];
  const user = typeof d.user_id === "string" ? d.user_id : "";
  if (!kind || !UUID.test(user)) return null;
  return {
    p_user: user.toLowerCase(),
    p_event: kind,
    p_event_id: eventId ?? null,
    p_fields: Array.isArray(d.changed) ? d.changed.filter((f): f is string => typeof f === "string") : [],
    p_by_admin: typeof d.by_admin === "boolean" ? d.by_admin : null,
  };
}

// ----------------------------------------------------------------- pictures --

/** ImageKit files removed per batch; the database lists the next batch each time. */
export const MEDIA_PURGE_BATCH = 50;

/** A picture the database wants gone from ImageKit. The file id is empty when the upload was never finished. */
export type PurgeRow = { id: string; provider_file_id: string | null; path: string };

/**
 * Removes one batch of pictures from ImageKit and tells the database which are
 * gone. A picture that was never attached has no file id, so it is found by the
 * exact path the server chose for it; if ImageKit has nothing there it counts as
 * gone. A failure on one picture does not stop the others: the ones that went are
 * recorded first, then this throws so Inngest retries the rest.
 */
export async function purgeMediaBatch(
  rpc: Rpc,
  cfg: ImageKitConfig,
  fetcher: ImageKitFetch,
): Promise<{ purged: number; more: boolean }> {
  const batch = (await call<PurgeRow[] | null>(rpc, "media_purge_batch", { p_limit: MEDIA_PURGE_BATCH })) ?? [];
  const done: string[] = [];
  let failed = 0;
  for (const row of batch) {
    try {
      const fileId = row.provider_file_id ?? (await findFileId(cfg, fetcher, row.path));
      if (fileId) await deleteFile(cfg, fetcher, fileId);
      done.push(row.id);
    } catch (e) {
      failed++;
      console.error("media purge: could not remove", row.id, e instanceof Error ? e.message : e);
    }
  }
  if (done.length > 0) await call<number>(rpc, "media_mark_purged", { p_ids: done });
  if (failed > 0) throw new Error(`media purge: ${failed} of ${batch.length} pictures could not be removed`);
  return { purged: done.length, more: batch.length === MEDIA_PURGE_BATCH };
}
