/**
 * Plan B money (task 2.21, migration 195): one interface for Razorpay Route (decision 3, decided 19 Nov 2026),
 * which holds each task's money, with a simulated stand-in for staging. Postgres decides every amount and every state; an adapter only carries out one outside call and
 * says what happened. Design: docs/design/plan-b-money/DESIGN.md §5.
 *
 * Plain TypeScript with no Deno or npm imports, so the node test runner can load it.
 */

export type ProviderName = "razorpay_route" | "simulated";
export type Environment = "staging" | "production";
export type PayeeStatus = "pending" | "active" | "rejected" | "suspended";

/** What a worker types once in "Get paid". Sent straight to the provider; never stored or logged by us. */
export type PayeeInput = {
  userId: string;
  name: string;
  pan: string;
  method: "upi" | "bank";
  upi?: string;
  accountNumber?: string;
  ifsc?: string;
  email?: string | null;
  phone?: string | null;
};

export type PayeeResult = {
  accountId: string;
  status: PayeeStatus;
  /** Masked, for the app: "UPI ••••@okhdfc" or "Bank ••1234". */
  hint: string;
  note?: string | null;
};

/** What plan_b_checkout_terms returned, plus who is paying. */
export type StartInput = {
  holdId: string;
  taskId: string;
  title: string;
  chargedMinor: number;
  workerShareMinor: number;
  payeeAccountId: string;
  posterId: string;
  posterPhone?: string | null;
  posterEmail?: string | null;
  returnUrl?: string | null;
};

/**
 * How the poster pays. `ref` is what we keep in task_holds.checkout_url, so the same order can be shown
 * again without asking the provider for a new one.
 */
export type StartResult = { orderId: string; ref: string };

/** A page the app opens to pay: a plain address, or a small HTML page that hands over to the provider. */
export type CheckoutPage = { url?: string; html?: string };

export type PaymentState = {
  paid: boolean;
  paymentId?: string | null;
  transferId?: string | null;
  amountMinor?: number | null;
};

/** One claimed move, from plan_b_claim_move. */
export type MoveInput = {
  holdId: string;
  part: "release" | "refund";
  /** 'release_asked' | 'refund_asked' | 'split_asked' */
  status: string;
  amountMinor: number;
  chargedMinor: number;
  workerShareMinor: number;
  key: string;
  orderId: string | null;
  paymentId: string | null;
  transferId: string | null;
  payeeAccountId: string | null;
};

/**
 * ok: the provider accepted it (ref is its id). ok false + definite: it refused, mark the hold failed for
 * staff. A network failure is thrown instead: the outcome is unknown, so the claim is left to expire and
 * the move is retried with the same key.
 */
export type MoveResult = { ok: true; ref: string } | { ok: false; note: string };

export type WebhookEvent = {
  /** The provider's own id for this message, so a repeat is dropped. */
  id: string;
  kind: "payment.paid" | "payee.status" | "move.failed" | "other";
  raw: string;
  orderId?: string | null;
  paymentId?: string | null;
  transferId?: string | null;
  amountMinor?: number | null;
  accountId?: string | null;
  payeeStatus?: PayeeStatus | null;
  note?: string | null;
};

export type SettlementTotal = { totalMinor: number; rows: number } | null;

export interface MoneyProvider {
  readonly name: ProviderName;
  setupPayee(input: PayeeInput): Promise<PayeeResult>;
  payeeStatus(accountId: string): Promise<{ status: PayeeStatus; note?: string | null }>;
  startPayment(input: StartInput): Promise<StartResult>;
  checkoutPage(ref: string, ctx: { orderId: string; chargedMinor: number; title: string; returnUrl?: string | null }): CheckoutPage;
  readPayment(orderId: string): Promise<PaymentState>;
  release(move: MoveInput): Promise<MoveResult>;
  refund(move: MoveInput): Promise<MoveResult>;
  /** The provider's total of payments taken that day (IST), or null when it has no report we can read. */
  settlementTotal(day: string): Promise<SettlementTotal>;
  /** Null when the signature does not check out. */
  verifyWebhook(raw: string, headers: Headers): Promise<WebhookEvent | null>;
}

/** A provider call that failed in a way that leaves the outcome unknown (network, 5xx, timeout). */
export class UnknownOutcome extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnknownOutcome";
  }
}

export type Fetch = typeof fetch;
