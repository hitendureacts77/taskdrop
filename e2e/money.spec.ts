import { test, expect, type APIRequestContext, type Browser } from "@playwright/test";
import { ASHA, RAVI, accessToken, apiAs, must, tidyE2eTasks } from "./helpers";

/**
 * The money paths, through the app's single door (the `api` function) as the two seed accounts, signed in
 * through the real sign-in screen by auth.setup.ts. This is the same call the web app makes for each tap,
 * so every rule the server enforces (who may do what, what each step costs) is exercised for real; the
 * screens themselves are covered in ui.spec.ts.
 *
 * Each run creates a few "[e2e]" tasks and moves a few hundred rupees of fake money between Asha and Ravi, in
 * whichever direction beforeAll picks. `npm run seed:reset` puts the seed accounts back (only
 * with the owner's OK).
 */

type Wallet = { balance_minor: number; clearing_minor: number };
type Fees = { commission: number; posterFee: number; cancelFine: number };
type Detail = { task: { id: string; status: string; funded_at: string | null }; assignment: { escrow_minor: number } | null };
type Call = ReturnType<typeof apiAs>;

let poster: Call;
let worker: Call;
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
    await poster<{ id: string }>("createTask", {
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
    await worker<{ id: string }>("placeBid", { taskId: task.id, priceMinor, timeLimitMinutes: 60, message: "I can do this today." }),
    "placeBid",
  );
  must(await poster("lockBid", { bidId: bid.id }), "lockBid");
  return { taskId: task.id, bidId: bid.id };
}

const detail = async (who: Call, taskId: string) => must(await who<Detail>("getTaskDetail", { taskId }), "getTaskDetail");

test.describe.configure({ mode: "serial" });

let walletFlow = true;
test.beforeEach(() => {
  test.skip(!walletFlow, "The server is on Plan B (money_flow = plan_b): the wallet money path does not apply (planB.spec.ts).");
});

test.beforeAll(async ({ browser, playwright }) => {
  const request = await playwright.request.newContext();
  const asha = await session(browser, ASHA.state, request);
  const ravi = await session(browser, RAVI.state, request);
  // Every test here is the wallet flow (money paid from the wallet, withdrawals). On a server with
  // money_flow = plan_b nothing is taken from the wallet, so these do not apply; planB.spec.ts covers that flow
  // and skips itself the other way round.
  const mode = must(await asha<{ flow: "wallet" | "plan_b" }>("getMoneyMode"), "getMoneyMode");
  walletFlow = mode.flow === "wallet";
  if (!walletFlow) return;
  // Every run moves fake money from the poster to the worker, and a test cannot add any (Add funds is the
  // Razorpay page). Both seed accounts can post and work, so one of them pays this run (chosen below) and the
  // other one works: the money goes back and forth instead of draining one wallet (it ran Asha's down to ₹23 by
  // 20 Nov).
  fees = must(await asha<Fees>("platformFees"), "platformFees");
  // The three ₹100 jobs below. Fees, fines and the disputed job's frozen money still leave the pair slowly.
  const needed = 3 * Math.round(10_000 * (1 + fees.posterFee));
  // A young account may post only a few jobs a day (migration 152: 5 in 24 hours until it is 30 days old), so of
  // the two with enough money, the one that has posted less today pays; then the one with more money.
  const look = async (who: Call) => {
    const mine = await who<{ created_at: string }[]>("listMyTasks");
    const today = mine.ok && Array.isArray(mine.data) ? mine.data.filter((t) => Date.parse(t.created_at) > Date.now() - 86_400_000).length : 0;
    return { who, balance: (await wallet(who)).balance_minor, today };
  };
  const both = await Promise.all([look(asha), look(ravi)]);
  const able = both.filter((b) => b.balance >= needed).sort((a, b) => a.today - b.today || b.balance - a.balance);
  if (!able[0]) {
    const has = Math.max(...both.map((b) => b.balance));
    throw new Error(`The fuller seed wallet has ₹${has / 100}, the money tests need ₹${needed / 100}: put the seed money back (owner's OK).`);
  }
  poster = able[0].who;
  worker = poster === asha ? ravi : asha;
});

test.afterAll(async () => {
  if (poster) await tidyE2eTasks(poster).catch(() => 0);
  await Promise.all(contexts.map((c) => c.close()));
});

test("the wallet-funded money path: post, offer, lock, fund, start, proof, done, confirm, review", async () => {
  const price = 10_000; // ₹100
  const posterBefore = await wallet(poster);
  const workerBefore = await wallet(worker);

  const { taskId } = await lockedJob(price, "money path");

  // Locking the offer took the price plus the service fee out of the poster's wallet, and the task is funded.
  const held = Math.round(price * (1 + fees.posterFee));
  const locked = await detail(poster, taskId);
  expect(locked.assignment?.escrow_minor).toBe(held);
  expect(locked.task.funded_at).not.toBeNull();
  expect(locked.task.status).toBe("LOCKED");
  expect(total(await wallet(poster))).toBe(total(posterBefore) - held);

  // Only the hired worker starts it, and nobody else can.
  const refused = await poster("startTask", { taskId });
  expect(refused.ok).toBe(false);
  must(await worker("startTask", { taskId }), "startTask");
  expect((await detail(poster, taskId)).task.status).toBe("TASK_STARTED");

  // Proof, then done.
  must(await worker("submitProof", { taskId, summary: "Finished. Photos in the chat.", files: [] }), "submitProof");
  must(await worker("markWorkDone", { taskId }), "markWorkDone");
  expect((await detail(poster, taskId)).task.status).toBe("WORK_DONE");

  // The poster approves: the worker is paid the price less commission (to clearing, or straight to balance).
  must(await poster("confirmRelease", { taskId }), "confirmRelease");
  expect((await detail(poster, taskId)).task.status).toBe("COMPLETED");
  must(await worker("settleClearedEarnings"), "settleClearedEarnings");
  const net = Math.round(price * (1 - fees.commission));
  expect(total(await wallet(worker))).toBe(total(workerBefore) + net);
  // The poster paid exactly what was held, nothing more.
  expect(total(await wallet(poster))).toBe(total(posterBefore) - held);

  // Both sides can review the finished job. Out-of-range ratings are refused.
  must(await poster("submitReview", { taskId, rating: 5, comment: "Quick and tidy." }), "poster review");
  must(await worker("submitReview", { taskId, rating: 5, comment: "Clear brief, paid fast." }), "worker review");
  expect((await poster("submitReview", { taskId, rating: 9, comment: "Too high." })).ok).toBe(false);
});

test("a withdrawal request is accepted, takes the money out at once, and can be cancelled", async () => {
  // As the paying account: the only one sure to have ₹100 to spend (the worker may be the emptier wallet).
  const destinations = must(await poster<{ id: string }[]>("listPayoutDestinations"), "listPayoutDestinations");
  const destination =
    destinations[0] ??
    must(await poster<{ id: string }>("addPayoutDestination", { kind: "upi", upiId: "seed.e2e@okaxis", label: "e2e UPI" }), "addPayoutDestination");

  const before = await wallet(poster);
  expect(before.balance_minor).toBeGreaterThanOrEqual(10_000);
  const started = Date.now();
  const payout = must(await poster<{ id: string }>("requestWithdrawal", { amountMinor: 10_000, destinationId: destination.id }), "requestWithdrawal");
  // Phase 5's target is under a second for the app; here we only insist it is not slow.
  expect(Date.now() - started).toBeLessThan(5000);
  expect((await wallet(poster)).balance_minor).toBe(before.balance_minor - 10_000);

  must(await poster("cancelWithdrawal", { payoutId: payout.id }), "cancelWithdrawal");
  expect((await wallet(poster)).balance_minor).toBe(before.balance_minor);

  // Below the minimum, or more than there is, is refused by the server.
  expect((await poster("requestWithdrawal", { amountMinor: 100, destinationId: destination.id })).ok).toBe(false);
  expect((await poster("requestWithdrawal", { amountMinor: before.balance_minor + 1_000_000, destinationId: destination.id })).ok).toBe(false);
});

test("cancelling after the work started costs the poster the fine, which goes to the worker", async () => {
  const price = 10_000;
  const posterBefore = await wallet(poster);
  const workerBefore = await wallet(worker);

  const { taskId } = await lockedJob(price, "cancel with fine");
  must(await worker("startTask", { taskId }), "startTask");
  must(await poster("cancelTask", { taskId, reason: "End-to-end test of the post-start fine." }), "cancelTask");

  const fine = Math.round(price * fees.cancelFine);
  expect((await detail(poster, taskId)).task.status).toBe("CANCELLED");
  // The poster is out the fine only (the service fee comes back too); the worker has it in their balance.
  expect(total(await wallet(poster))).toBe(total(posterBefore) - fine);
  expect(total(await wallet(worker))).toBe(total(workerBefore) + fine);
});

test("a dispute freezes the money and only a participant can open one", async () => {
  const { taskId } = await lockedJob(10_000, "dispute");
  must(await worker("startTask", { taskId }), "startTask");
  must(await worker("submitProof", { taskId, summary: "Done as agreed.", files: [] }), "submitProof");
  must(await worker("markWorkDone", { taskId }), "markWorkDone");

  const posterMid = await wallet(poster);
  must(await poster("openDispute", { taskId, reason: "End-to-end test: the work was not what was agreed." }), "openDispute");
  expect((await detail(poster, taskId)).task.status).toBe("DISPUTED");
  // Nothing moved by opening it; an admin decides from here.
  expect(total(await wallet(poster))).toBe(total(posterMid));
  // And it cannot simply be confirmed over the dispute.
  expect((await poster("confirmRelease", { taskId })).ok).toBe(false);
});
