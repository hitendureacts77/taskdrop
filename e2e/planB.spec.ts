import { test, expect, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ANON_KEY, ASHA, RAVI, SUPABASE_URL, accessToken, apiAs, closeStagingCard, must, tidyE2eTasks } from "./helpers";

/**
 * Plan B money (pay per task: the payment company holds the money until the poster approves), end to end on
 * the staging project with the SIMULATED provider (no real money). Skips itself unless the server says
 * money_flow = plan_b, so the normal wallet suite (money.spec.ts) is not affected.
 *
 * Driven through the screens: the worker's "Get paid" set-up, hiring, the test payment, the hold line, the
 * poster's approval, and the Money screen. Set-up steps (post, offer, start, proof) use the api; cancels and the
 * dispute use the api too, and the screens are asked what they show afterwards.
 * Admin resolution of a dispute is not covered here (no seed admin).
 */

type Call = ReturnType<typeof apiAs>;
type Mode = { flow: "wallet" | "plan_b"; provider: string; paused: boolean; payee: { status: string } | null };
type Hold = {
  status: string;
  stuck: boolean;
  charged_minor: number;
  offer_minor: number;
  release_minor: number | null;
  refund_minor: number | null;
  mine: "poster" | "worker";
};

const PRICE = 10_000; // ₹100
const FINE_PCT = 0.05;

let request: APIRequestContext;
let poster: Call;
let worker: Call;
let posterToken = "";
let workerToken = "";
let posterAccount = ASHA;
let workerAccount = RAVI;
let planB = false;
const contexts: BrowserContext[] = [];
let browserRef: Browser;

async function open(who: typeof ASHA, mode: "poster" | "worker"): Promise<Page> {
  const context = await browserRef.newContext({ storageState: who.state, viewport: { width: 1280, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  await page.addInitScript((m) => localStorage.setItem("taskdrop.mode", m), mode);
  await page.goto("/");
  await expect(page.getByText("Wallet").first()).toBeVisible();
  await closeStagingCard(page);
  return page;
}

async function token(who: typeof ASHA): Promise<string> {
  const context = await browserRef.newContext({ storageState: who.state });
  const page = await context.newPage();
  await page.goto("/");
  const tk = await accessToken(page);
  await context.close();
  return tk;
}

/** The `money` Edge Function, as a signed-in person (checkout, sync, settle). */
async function money(tk: string, body: Record<string, unknown>) {
  const res = await request.post(`${SUPABASE_URL}/functions/v1/money`, {
    headers: { Authorization: `Bearer ${tk}`, apikey: ANON_KEY, "x-taskdrop-platform": "web", "x-taskdrop-app-version": "1.0.0" },
    data: body,
  });
  return (await res.json().catch(() => ({}))) as Record<string, unknown>;
}

const hold = async (who: Call, taskId: string) => must(await who<Hold | null>("getTaskHold", { taskId }), "getTaskHold");

/** Poll until the hold reaches one of the states (releases and refunds are carried out a moment after the tap). */
async function holdReaches(who: Call, taskId: string, states: string[], tk: string, timeoutMs = 60_000): Promise<Hold> {
  const until = Date.now() + timeoutMs;
  let last: Hold | null = null;
  while (Date.now() < until) {
    last = await hold(who, taskId);
    if (last && states.includes(last.status)) return last;
    await money(tk, { action: "settle", taskId });
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`The hold on ${taskId} never reached ${states.join("/")}; last seen: ${last?.status ?? "none"}`);
}

/** A posted task with the worker's offer on it. */
async function offeredJob(title: string) {
  const task = must(
    await poster<{ id: string }>("createTask", {
      pillar: "services",
      title: `[e2e] ${title}`,
      description: "End-to-end test of Plan B. Safe to ignore; it is removed when the test data is reset.",
      benchmarkMinor: PRICE,
      timeLimitMinutes: 60,
      kind: "request",
      assignmentMode: "bids",
    }),
    "createTask",
  );
  const bid = must(
    await worker<{ id: string }>("placeBid", { taskId: task.id, priceMinor: PRICE, timeLimitMinutes: 60, message: "I can do this today." }),
    "placeBid",
  );
  return { taskId: task.id, bidId: bid.id, title: `[e2e] ${title}` };
}

/** Pay the hold with the simulated test payment, the way the test sheet does (no screen). */
async function payHold(taskId: string) {
  const out = await money(posterToken, { action: "checkout", taskId, returnUrl: `${SUPABASE_URL}/` });
  expect(out.error, `checkout: ${String(out.error)}`).toBeUndefined();
  const synced = await money(posterToken, { action: "sync", taskId, simulate: true });
  expect(synced.status, `sync: ${JSON.stringify(synced)}`).toBe("held");
}

async function paidAndHired(title: string) {
  const job = await offeredJob(title);
  must(await poster("lockBid", { bidId: job.bidId }), "lockBid");
  await payHold(job.taskId);
  return job;
}

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async ({ browser, playwright }) => {
  browserRef = browser;
  request = await playwright.request.newContext();
  const asha = apiAs(request, await token(ASHA));
  const ravi = apiAs(request, await token(RAVI));
  const mode = must(await asha<Mode>("getMoneyMode"), "getMoneyMode");
  planB = mode.flow === "plan_b";
  if (!planB) return;
  // A young account may post only a few jobs a day; this file posts 4. The one that posted less today is the poster.
  const today = async (who: Call) => {
    const mine = await who<{ created_at: string }[]>("listMyTasks");
    return mine.ok && Array.isArray(mine.data) ? mine.data.filter((t) => Date.parse(t.created_at) > Date.now() - 86_400_000).length : 0;
  };
  const a = await today(asha);
  const r = await today(ravi);
  if (a <= r) {
    poster = asha;
    worker = ravi;
    posterAccount = ASHA;
    workerAccount = RAVI;
  } else {
    poster = ravi;
    worker = asha;
    posterAccount = RAVI;
    workerAccount = ASHA;
  }
  posterToken = await token(posterAccount);
  workerToken = await token(workerAccount);
});

test.afterEach(async () => {
  // A page left open keeps asking the server (notifications, lists) and the per-person limit answers 429.
  await Promise.all(contexts.splice(0).map((c) => c.close().catch(() => undefined)));
});

test.beforeEach(() => {
  test.skip(!planB, "The server is on the wallet flow (money_flow != plan_b): the Plan B walk-through does not apply.");
});

test.afterAll(async () => {
  if (poster) await tidyE2eTasks(poster).catch(() => 0);
  if (worker) await tidyE2eTasks(worker).catch(() => 0);
  await Promise.all(contexts.map((c) => c.close()));
});

test("a. the worker adds Get paid details on the Money screen", async () => {
  const page = await open(workerAccount, "worker");
  await page.getByText("Wallet", { exact: true }).first().click();
  await expect(page.getByText("Each task is paid for on its own")).toBeVisible();
  const status = must(await worker<Mode>("getMoneyMode"), "getMoneyMode").payee?.status;
  if (status !== "active") {
    await page.getByText("Set up", { exact: true }).click();
    await page.getByLabel("Name as on your PAN").fill("Test Worker");
    await page.getByLabel("PAN", { exact: true }).fill("ABCPE1234F");
    await page.getByLabel("UPI ID").fill("success@razorpay");
    await page.getByRole("button", { name: "Save payout details" }).click();
    await expect(page.getByText("You are set up to get paid")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
  }
  await expect(page.getByText(/Get paid is set up/)).toBeVisible();
  expect(must(await worker<Mode>("getMoneyMode"), "getMoneyMode").payee?.status).toBe("active");
});

test("b+c. hire, pay on the Plan B sheet, held, start, proof, done, approve, released", async () => {
  const job = await offeredJob("planb happy path");
  const page = await open(posterAccount, "poster");

  // Hire through the screens: My Tasks -> the task -> the offer -> Choose offer -> pay.
  await page.getByText("My Tasks", { exact: true }).first().click();
  await page.getByText(job.title, { exact: true }).filter({ visible: true }).first().click();
  await page.getByText(/Review the offer|Compare 1 offers?/).filter({ visible: true }).first().click();
  await page.getByText(/^Choose offer/).filter({ visible: true }).first().click();
  await expect(page.getByText("Held by Razorpay until you approve").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Total to pay")).toBeVisible();
  await page.getByText(/^Pay ₹/).first().click();

  // Staging runs the simulated provider: the test-payment sheet, not Razorpay.
  await expect(page.getByText("Test payment (staging)")).toBeVisible({ timeout: 30_000 });
  await page.getByText(/\(test\)$/).click();

  // The task screen shows the hold line.
  await expect(page.getByText("Paid and held by Razorpay")).toBeVisible({ timeout: 30_000 });
  const held = await hold(poster, job.taskId);
  expect(held?.status).toBe("held");
  expect(held?.charged_minor).toBe(Math.round(PRICE * 1.03));

  // The worker does the work (api), the poster approves on the screen.
  must(await worker("startTask", { taskId: job.taskId }), "startTask");
  must(await worker("submitProof", { taskId: job.taskId, summary: "Finished. Photos in the chat.", files: [] }), "submitProof");
  must(await worker("markWorkDone", { taskId: job.taskId }), "markWorkDone");

  await page.getByText("Home", { exact: true }).first().click();
  await page.getByText("My Tasks", { exact: true }).first().click();
  await page.getByText(job.title, { exact: true }).filter({ visible: true }).first().click();
  // The row's button can still say "Track the work" when the list was loaded before the work was done
  // (the list is kept from the first visit); both lead to a release button.
  await page.getByText(/^(Review the work and release|Track the work)$/).filter({ visible: true }).first().click();
  await page.getByText(/^(Confirm and release payment|Approve and release payment)$/).filter({ visible: true }).first().click();
  await page.getByText("Yes, release payment").filter({ visible: true }).first().click({ timeout: 5_000 }).catch(() => undefined);

  const done = await holdReaches(poster, job.taskId, ["released"], posterToken);
  expect(done.release_minor ?? 0).toBeGreaterThan(0);

  // The worker's Money screen shows the release.
  const wpage = await open(workerAccount, "worker");
  await wpage.getByText("Wallet", { exact: true }).first().click();
  await expect(wpage.getByText("Sent to your bank or UPI").first()).toBeVisible({ timeout: 30_000 });
});

test("d. cancel before the work starts: full refund", async () => {
  const job = await paidAndHired("planb cancel before start");
  must(await poster("cancelTask", { taskId: job.taskId, reason: "End-to-end test: cancel before start." }), "cancelTask");
  const h = await holdReaches(poster, job.taskId, ["refunded"], posterToken);
  expect(h.refund_minor).toBe(h.charged_minor);

  const page = await open(posterAccount, "poster");
  await page.getByText("Wallet", { exact: true }).first().click();
  await expect(page.getByText("Refunded to your card or UPI").first()).toBeVisible({ timeout: 30_000 });
});

test("e. cancel after the work started: 5% goes to the worker", async () => {
  const job = await paidAndHired("planb cancel after start");
  must(await worker("startTask", { taskId: job.taskId }), "startTask");
  must(await poster("cancelTask", { taskId: job.taskId, reason: "End-to-end test: cancel after start." }), "cancelTask");
  const h = await holdReaches(poster, job.taskId, ["split"], posterToken);
  expect(h.release_minor).toBe(Math.round(PRICE * FINE_PCT));
  expect(h.refund_minor).toBe(h.charged_minor - Math.round(PRICE * FINE_PCT));
  expect((await hold(worker, job.taskId))?.release_minor).toBe(Math.round(PRICE * FINE_PCT));

  const page = await open(workerAccount, "worker");
  await page.getByText("Wallet", { exact: true }).first().click();
  await expect(page.getByText("For your time (cancelled after start)").first()).toBeVisible({ timeout: 30_000 });
  void workerToken;
});

test("f. a dispute keeps the money held; approving over it is refused", async () => {
  const job = await paidAndHired("planb dispute");
  must(await worker("startTask", { taskId: job.taskId }), "startTask");
  must(await worker("submitProof", { taskId: job.taskId, summary: "Done as agreed.", files: [] }), "submitProof");
  must(await worker("markWorkDone", { taskId: job.taskId }), "markWorkDone");
  must(await poster("openDispute", { taskId: job.taskId, reason: "End-to-end test: the work was not what was agreed." }), "openDispute");

  const h = await hold(poster, job.taskId);
  expect(h?.status).toBe("held");
  expect((await poster("confirmRelease", { taskId: job.taskId })).ok).toBe(false);
  const detail = must(await poster<{ task: { status: string } }>("getTaskDetail", { taskId: job.taskId }), "getTaskDetail");
  expect(detail.task.status).toBe("DISPUTED");
  // Only an admin resolves it (admin_resolve_dispute): there is no seed admin, so that half is not covered here.
});
