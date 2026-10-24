import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { ASHA, RAVI, accessToken, apiAs, must, tidyE2eTasks } from "./helpers";

/**
 * The money paths, through the app's single door (the `api` function) as the two seed accounts, signed in
 * through the real sign-in screen by auth.setup.ts. This is the same call the web app makes for each tap,
 * so every rule the server enforces (who may do what, what each step costs) is exercised for real; the
 * screens themselves are covered in ui.spec.ts.
 *
 * Each run creates a few "[e2e]" tasks and moves a few hundred rupees of fake money. `npm run seed:reset`
 * puts the seed accounts back (only with the owner's OK). What a run leaves half-way is cancelled or approved at
 * the end (tidyE2eTasks); the dispute test leaves one disputed job, which only an admin can decide.
 */

type Wallet = { balance_minor: number; clearing_minor: number };
type Fees = { commission: number; posterFee: number; cancelFine: number };
type Detail = { task: { id: string; status: string; funded_at: string | null }; assignment: { escrow_minor: number } | null };
type Call = ReturnType<typeof apiAs>;

let asha: Call;
let ravi: Call;
let fees: Fees;
const contexts: { close(): Promise<void> }[] = [];

async function session(browser: Browser, state: string, request: APIRequestContext): Promise<Call> {
  const context = await browser.newContext({ storageState: state });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/");
  return apiAs(request, await accessToken(page));
}

const wallet = async (who: Call) => must(await who<Wallet>("getWallet"), "getWallet");
const total = (w: Wallet) => w.balance_minor + w.clearing_minor;

/** A posted, quoted and locked job: the poster has paid its price plus the service fee from the wallet. */
async function lockedJob(priceMinor: number, title: string) {
  const task = must(
    await asha<{ id: string }>("createTask", {
      pillar: "services",
      title: `[e2e] ${title}`,
      description: "End-to-end test task. Safe to ignore; it is removed when the test data is reset.",
      benchmarkMinor: priceMinor,
      timeLimitMinutes: 60,
      kind: "request",
      assignmentMode: "bids",
    }),
    "createTask",
  );
  const bid = must(
    await ravi<{ id: string }>("placeBid", { taskId: task.id, priceMinor, timeLimitMinutes: 60, message: "I can do this today." }),
    "placeBid",
  );
  must(await asha("lockBid", { bidId: bid.id }), "lockBid");
  return { taskId: task.id, bidId: bid.id };
}

const detail = async (who: Call, taskId: string) => must(await who<Detail>("getTaskDetail", { taskId }), "getTaskDetail");

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, playwright }) => {
  const request = await playwright.request.newContext();
  asha = await session(browser, ASHA.state, request);
  ravi = await session(browser, RAVI.state, request);
  fees = must(await asha<Fees>("platformFees"), "platformFees");
});

test.afterAll(async () => {
  if (asha) await tidyE2eTasks(asha).catch(() => 0);
  await Promise.all(contexts.map((c) => c.close()));
});

test("the wallet-funded money path: post, offer, lock, fund, start, proof, done, confirm, review", async () => {
  const price = 10_000; // ₹100
  const ashaBefore = await wallet(asha);
  const raviBefore = await wallet(ravi);

  const { taskId } = await lockedJob(price, "money path");

  // Locking the offer took the price plus the service fee out of the poster's wallet, and the task is funded.
  const held = Math.round(price * (1 + fees.posterFee));
  const locked = await detail(asha, taskId);
  expect(locked.assignment?.escrow_minor).toBe(held);
  expect(locked.task.funded_at).not.toBeNull();
  expect(locked.task.status).toBe("LOCKED");
  expect(total(await wallet(asha))).toBe(total(ashaBefore) - held);

  // Only the hired worker starts it, and nobody else can.
  const refused = await asha("startTask", { taskId });
  expect(refused.ok).toBe(false);
  must(await ravi("startTask", { taskId }), "startTask");
  expect((await detail(asha, taskId)).task.status).toBe("TASK_STARTED");

  // Proof, then done.
  must(await ravi("submitProof", { taskId, summary: "Finished. Photos in the chat.", files: [] }), "submitProof");
  must(await ravi("markWorkDone", { taskId }), "markWorkDone");
  expect((await detail(asha, taskId)).task.status).toBe("WORK_DONE");

  // The poster approves: the worker is paid the price less commission (to clearing, or straight to balance).
  must(await asha("confirmRelease", { taskId }), "confirmRelease");
  expect((await detail(asha, taskId)).task.status).toBe("COMPLETED");
  must(await ravi("settleClearedEarnings"), "settleClearedEarnings");
  const net = Math.round(price * (1 - fees.commission));
  expect(total(await wallet(ravi))).toBe(total(raviBefore) + net);
  // The poster paid exactly what was held, nothing more.
  expect(total(await wallet(asha))).toBe(total(ashaBefore) - held);

  // Both sides can review the finished job. Out-of-range ratings are refused.
  must(await asha("submitReview", { taskId, rating: 5, comment: "Quick and tidy." }), "poster review");
  must(await ravi("submitReview", { taskId, rating: 5, comment: "Clear brief, paid fast." }), "worker review");
  expect((await asha("submitReview", { taskId, rating: 9, comment: "Too high." })).ok).toBe(false);
});

test("a withdrawal request is accepted, takes the money out at once, and can be cancelled", async () => {
  const destinations = must(await ravi<{ id: string }[]>("listPayoutDestinations"), "listPayoutDestinations");
  const destination =
    destinations[0] ??
    must(await ravi<{ id: string }>("addPayoutDestination", { kind: "upi", upiId: "ravi.e2e@okaxis", label: "e2e UPI" }), "addPayoutDestination");

  const before = await wallet(ravi);
  expect(before.balance_minor).toBeGreaterThanOrEqual(10_000);
  const started = Date.now();
  const payout = must(await ravi<{ id: string }>("requestWithdrawal", { amountMinor: 10_000, destinationId: destination.id }), "requestWithdrawal");
  // Phase 5's target is under a second for the app; here we only insist it is not slow.
  expect(Date.now() - started).toBeLessThan(5000);
  expect((await wallet(ravi)).balance_minor).toBe(before.balance_minor - 10_000);

  must(await ravi("cancelWithdrawal", { payoutId: payout.id }), "cancelWithdrawal");
  expect((await wallet(ravi)).balance_minor).toBe(before.balance_minor);

  // Below the minimum, or more than there is, is refused by the server.
  expect((await ravi("requestWithdrawal", { amountMinor: 100, destinationId: destination.id })).ok).toBe(false);
  expect((await ravi("requestWithdrawal", { amountMinor: before.balance_minor + 1_000_000, destinationId: destination.id })).ok).toBe(false);
});

test("cancelling after the work started costs the poster the fine, which goes to the worker", async () => {
  const price = 10_000;
  const ashaBefore = await wallet(asha);
  const raviBefore = await wallet(ravi);

  const { taskId } = await lockedJob(price, "cancel with fine");
  must(await ravi("startTask", { taskId }), "startTask");
  must(await asha("cancelTask", { taskId, reason: "End-to-end test of the post-start fine." }), "cancelTask");

  const fine = Math.round(price * fees.cancelFine);
  expect((await detail(asha, taskId)).task.status).toBe("CANCELLED");
  // The poster is out the fine only (the service fee comes back too); the worker has it in their balance.
  expect(total(await wallet(asha))).toBe(total(ashaBefore) - fine);
  expect(total(await wallet(ravi))).toBe(total(raviBefore) + fine);
});

test("a dispute freezes the money and only a participant can open one", async () => {
  const { taskId } = await lockedJob(10_000, "dispute");
  must(await ravi("startTask", { taskId }), "startTask");
  must(await ravi("submitProof", { taskId, summary: "Done as agreed.", files: [] }), "submitProof");
  must(await ravi("markWorkDone", { taskId }), "markWorkDone");

  const ashaMid = await wallet(asha);
  must(await asha("openDispute", { taskId, reason: "End-to-end test: the work was not what was agreed." }), "openDispute");
  expect((await detail(asha, taskId)).task.status).toBe("DISPUTED");
  // Nothing moved by opening it; an admin decides from here.
  expect(total(await wallet(asha))).toBe(total(ashaMid));
  // And it cannot simply be confirmed over the dispute.
  expect((await asha("confirmRelease", { taskId })).ok).toBe(false);
});
