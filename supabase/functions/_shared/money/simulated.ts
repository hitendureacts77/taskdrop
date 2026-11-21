import type { MoneyProvider, PayeeInput } from "./types.ts";
import { payeeHint } from "./util.ts";

/**
 * A pretend payment company for staging, so the whole Plan B flow can be tried before Razorpay opens
 * Route on a test account for us. No money moves anywhere. The factory refuses to build it unless
 * the database's environment setting says "staging".
 *
 * Paying is a deliberate tap: the app shows "Test payment, no real money" and calls the money function's
 * sync with simulate: true. Releases and refunds always succeed, with the move's own key as the reference,
 * so a repeat is visibly the same move.
 */
export function simulatedProvider(): MoneyProvider {
  return {
    name: "simulated",
    async setupPayee(input: PayeeInput) {
      return {
        accountId: `sim_acc_${input.userId.replace(/-/g, "").slice(0, 16)}`,
        status: "active",
        hint: payeeHint(input.method, input.upi, input.accountNumber),
        note: "Test account (staging). No real money moves.",
      };
    },
    async payeeStatus() {
      return { status: "active" };
    },
    async startPayment(input) {
      return { orderId: `sim_order_${input.holdId}`, ref: "simulated" };
    },
    checkoutPage() {
      return {};
    },
    async readPayment() {
      return { paid: false };
    },
    async release(move) {
      return { ok: true, ref: `sim_${move.key}` };
    },
    async refund(move) {
      return { ok: true, ref: `sim_${move.key}` };
    },
    async settlementTotal() {
      return null;
    },
    async verifyWebhook() {
      return null;
    },
  };
}
