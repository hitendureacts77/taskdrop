import { razorpayRouteProvider, type RazorpayConfig } from "./razorpayRoute.ts";
import { simulatedProvider } from "./simulated.ts";
import { devModeAllowed } from "../devMode.ts";
import {
  type Environment,
  type Fetch,
  type MoneyProvider,
  type MoveInput,
  type PayeeInput,
  type ProviderName,
  UnknownOutcome,
} from "./types.ts";

export * from "./types.ts";

/**
 * Plan B money: building the provider and running one money move. Shared by the `money` and
 * `money-webhook` functions and the Inngest money jobs. No Deno or npm imports (node tests load it).
 */

export type ProviderConfig = {
  environment: Environment;
  /** This project's SUPABASE_URL: the simulated provider runs only on the staging project or localhost. */
  supabaseUrl?: string | null;
  razorpay?: RazorpayConfig | null;
  fetch?: Fetch;
};

/** The provider the database asked for, or an Error saying plainly why it cannot run here. */
export function makeProvider(name: string, cfg: ProviderConfig): MoneyProvider {
  if (name === "simulated") {
    // A pretend payment company must never answer for real money.
    // Both locks: the environment setting AND the project address, so a wrong setting alone cannot open it.
    if (cfg.environment !== "staging" || !devModeAllowed(cfg.supabaseUrl)) {
      throw new Error("The simulated payment provider only runs on staging.");
    }
    return simulatedProvider();
  }
  if (name === "razorpay_route") {
    const r = cfg.razorpay;
    if (!r?.keyId || !r.keySecret) throw new Error("Razorpay is not configured for Plan B (RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET).");
    return razorpayRouteProvider(r, cfg.fetch);
  }
  throw new Error(`Unknown payment provider: ${name}`);
}

export const isProviderName = (v: unknown): v is ProviderName => v === "razorpay_route" || v === "simulated";

/** Anything with a Supabase-style `rpc` (the service-role client). */
export type Rpc = {
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

export type MoveOutcome =
  | { hold: string; done: "nothing" }
  | { hold: string; done: "sent"; part: "release" | "refund"; state: string }
  | { hold: string; done: "refused"; part: "release" | "refund"; note: string }
  | { hold: string; done: "unknown"; part: "release" | "refund"; note: string };

/** Turn plan_b_claim_move's answer into a MoveInput, or null when there is nothing to do. */
export function moveFrom(claim: unknown): MoveInput | null {
  if (!claim || typeof claim !== "object") return null;
  const c = claim as Record<string, unknown>;
  const s = (k: string) => (typeof c[k] === "string" && c[k] !== "" ? (c[k] as string) : null);
  const n = (k: string) => Number(c[k] ?? 0);
  const part = c.part === "release" || c.part === "refund" ? c.part : null;
  if (!part || !s("hold_id") || !s("key")) return null;
  return {
    holdId: s("hold_id")!,
    part,
    status: s("status") ?? "",
    amountMinor: n("amount_minor"),
    chargedMinor: n("charged_minor"),
    workerShareMinor: n("worker_share_minor"),
    key: s("key")!,
    orderId: s("provider_order_id"),
    paymentId: s("provider_payment_id"),
    transferId: s("provider_transfer_id"),
    payeeAccountId: s("payee_account_id"),
  };
}

/**
 * Run the next waiting move for one hold: claim it in the database, make the one outside call, record
 * what the provider said. Safe to call from anywhere at any time:
 *   - the claim lasts 10 minutes, so two callers never send the same move at once;
 *   - every move carries its own key, so a retry after an unknown outcome is the same move;
 *   - a release while the money stop is on is not claimed at all (refunds still run).
 * A split needs two calls (refund, then the fine); runMoves loops for that.
 */
export async function runMove(db: Rpc, provider: MoneyProvider, holdId: string): Promise<MoveOutcome> {
  const { data, error } = await db.rpc("plan_b_claim_move", { p_hold_id: holdId });
  if (error) throw new Error(`plan_b_claim_move: ${error.message}`);
  const move = moveFrom(data);
  if (!move) return { hold: holdId, done: "nothing" };
  if (move.amountMinor <= 0) {
    // Nothing to send (a split with no fine): record it as done so the hold can finish.
    const r = await db.rpc("plan_b_record_move", { p_hold_id: holdId, p_part: move.part, p_ok: true, p_ref: "none", p_note: null });
    if (r.error) throw new Error(`plan_b_record_move: ${r.error.message}`);
    return { hold: holdId, done: "sent", part: move.part, state: String(r.data ?? "") };
  }

  let result;
  try {
    result = move.part === "release" ? await provider.release(move) : await provider.refund(move);
  } catch (e) {
    // Unknown outcome: leave the claim to run out and try again later with the same key.
    if (e instanceof UnknownOutcome) return { hold: holdId, done: "unknown", part: move.part, note: e.message };
    throw e;
  }
  const r = await db.rpc("plan_b_record_move", {
    p_hold_id: holdId,
    p_part: move.part,
    p_ok: result.ok,
    p_ref: result.ok ? result.ref : null,
    p_note: result.ok ? null : result.note,
  });
  if (r.error) throw new Error(`plan_b_record_move: ${r.error.message}`);
  return result.ok
    ? { hold: holdId, done: "sent", part: move.part, state: String(r.data ?? "") }
    : { hold: holdId, done: "refused", part: move.part, note: result.note };
}

/** Run a hold's moves until it has nothing more to send now (at most 3 rounds: a split is 2). */
export async function runMoves(db: Rpc, provider: MoneyProvider, holdId: string): Promise<MoveOutcome[]> {
  const out: MoveOutcome[] = [];
  for (let i = 0; i < 3; i++) {
    const o = await runMove(db, provider, holdId);
    out.push(o);
    if (o.done !== "sent") break;
  }
  return out;
}

// ------------------------------------------------------------------------------- Get paid --

const PAN = /^[A-Z]{3}P[A-Z][0-9]{4}[A-Z]$/; // the 4th letter is P for a person
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI = /^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$/;
const ACCOUNT = /^[0-9]{9,18}$/;

/**
 * Check what a worker typed in "Get paid" before it goes to the payment company. Returns the cleaned
 * input, or a plain message saying which field is wrong. The values are never logged.
 */
export function readPayee(userId: string, raw: Record<string, unknown>): PayeeInput | { error: string } {
  const text = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string).trim() : "");
  const name = text("name").replace(/\s+/g, " ");
  const pan = text("pan").toUpperCase();
  const method = raw.method === "bank" ? "bank" : raw.method === "upi" ? "upi" : null;
  if (name.length < 4 || name.length > 120) return { error: "Write your name as it is on your PAN card." };
  if (!PAN.test(pan)) return { error: "That PAN does not look right. It is 10 letters and numbers, like ABCPE1234F." };
  if (!method) return { error: "Choose UPI or bank account." };
  if (method === "upi") {
    const upi = text("upi").toLowerCase();
    if (!UPI.test(upi)) return { error: "That UPI ID does not look right. It looks like name@bank." };
    return { userId, name, pan, method, upi };
  }
  const accountNumber = text("accountNumber").replace(/\s/g, "");
  const ifsc = text("ifsc").toUpperCase();
  if (!ACCOUNT.test(accountNumber)) return { error: "The account number should be 9 to 18 digits." };
  if (!IFSC.test(ifsc)) return { error: "That IFSC does not look right. It is 11 characters, like HDFC0001234." };
  return { userId, name, pan, method, accountNumber, ifsc };
}
