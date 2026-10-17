/**
 * What the Inngest functions actually do, kept free of the Inngest SDK and of
 * Deno so it can be tested with plain Node (see jobs.test.ts).
 *
 * The rule of the house: Postgres owns the rules and the money. Nothing here
 * decides who gets paid or what a price is; it moves events, asks the database
 * to run the sweeps it already has, and leaves messages for the team.
 */

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
