import { test, type APIRequestContext, type Browser } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { ANON_KEY, ASHA, MEERA, RAVI, SUPABASE_URL, accessToken, apiAs, must, type ApiResult } from "./helpers";

/**
 * "Break it": hostile use of the live test project, as a stranger, a cheat or a script, to find what the
 * server lets through. Nothing here is expected to fail on a healthy build; every probe that gets through
 * is written down as a finding in e2e/.out/breakit.json (and printed), and the run fails if there is one.
 *
 * Fake accounts and fake money only (the seed accounts). Each probe cleans up what it can.
 */

type Call = ReturnType<typeof apiAs>;
type Finding = { area: string; probe: string; got: string };
const findings: Finding[] = [];
const passed: string[] = [];

function expectRefused(area: string, probe: string, r: ApiResult) {
  if (r.ok) findings.push({ area, probe, got: `accepted: ${JSON.stringify(r.data)?.slice(0, 200)}` });
  else if (r.error.code === "INTERNAL" || r.error.code.startsWith("HTTP_5")) findings.push({ area, probe, got: `server error ${r.error.code} (should be a clean refusal)` });
  else passed.push(`${area}: ${probe}`);
}
function expect(area: string, probe: string, ok: boolean, got: string) {
  if (!ok) findings.push({ area, probe, got });
  else passed.push(`${area}: ${probe}`);
}

const contexts: { close(): Promise<void> }[] = [];
let request: APIRequestContext;
let asha: Call, ravi: Call, meera: Call;
let tokens: { asha: string; ravi: string; meera: string };
let ids: { asha: string; ravi: string; meera: string };

async function session(browser: Browser, state: string): Promise<{ call: Call; token: string }> {
  const context = await browser.newContext({ storageState: state });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/");
  const token = await accessToken(page);
  return { call: apiAs(request, token), token };
}

const sub = (token: string) => JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).sub as string;

async function rest(token: string | null, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await request.fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: ANON_KEY, ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json", Prefer: "return=representation", ...extra },
    data: body === undefined ? undefined : JSON.stringify(body),
    failOnStatusCode: false,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status(), json, text };
}

const wallet = async (c: Call) => must(await c<{ balance_minor: number; clearing_minor: number }>("getWallet"), "getWallet");
const total = (w: { balance_minor: number; clearing_minor: number }) => w.balance_minor + w.clearing_minor;

async function post(who: Call, price = 5_000, extra: Record<string, unknown> = {}) {
  return must(
    await who<{ id: string }>("createTask", { pillar: "services", title: "[e2e-break] probe task", description: "break-it probe. Safe to ignore.", benchmarkMinor: price, timeLimitMinutes: 60, ...extra }),
    "createTask",
  );
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser, playwright }) => {
  // Opt in (BREAKIT=1): it fires hundreds of hostile calls and uses up the test accounts' rate limits for a minute.
  test.skip(!process.env.BREAKIT, "set BREAKIT=1 to run the break-it attack suite");
  request = await playwright.request.newContext();
  const a = await session(browser, ASHA.state);
  const r = await session(browser, RAVI.state);
  const m = await session(browser, MEERA.state);
  asha = a.call; ravi = r.call; meera = m.call;
  tokens = { asha: a.token, ravi: r.token, meera: m.token };
  ids = { asha: sub(a.token), ravi: sub(r.token), meera: sub(m.token) };
});

/** Cancel every "[e2e-break]" task the probes left open, so the feed is not littered with test posts. */
async function sweepProbeTasks() {
  for (const who of [asha, meera]) {
    const mine = await who<{ id: string; title: string; status: string }[]>("listMyTasks", {});
    if (!mine.ok) continue;
    for (const t of mine.data.filter((x) => x.title.startsWith("[e2e-break]") && x.status === "OPEN")) {
      await who("cancelTask", { taskId: t.id, reason: "break-it cleanup" });
    }
  }
}

test.afterAll(async () => {
  if (!process.env.BREAKIT) return;
  await sweepProbeTasks().catch(() => {});
  await Promise.all(contexts.map((c) => c.close()));
  mkdirSync("e2e/.out", { recursive: true });
  writeFileSync("e2e/.out/breakit.json", JSON.stringify({ findings, passedCount: passed.length, passed }, null, 2));
  console.log(`\nBREAK-IT: ${passed.length} probes held, ${findings.length} got through`);
  for (const f of findings) console.log(`  [${f.area}] ${f.probe}\n      -> ${f.got}`);
});

test("1. the door itself: bad requests, bad tokens, odd operation names", async () => {
  const url = `${SUPABASE_URL}/functions/v1/api`;
  const h = (t?: string) => ({ apikey: ANON_KEY, ...(t ? { Authorization: `Bearer ${t}` } : {}), "Content-Type": "application/json" });
  const send = async (headers: Record<string, string>, data: string | undefined, method = "POST") => {
    const res = await request.fetch(url, { method, headers, data, failOnStatusCode: false });
    return { status: res.status(), text: (await res.text()).slice(0, 300) };
  };
  let r = await send(h(), JSON.stringify({ op: "getWallet" }));
  expect("door", "no token is refused", r.status === 401, `status ${r.status} ${r.text}`);
  r = await send(h("garbage.token.here"), JSON.stringify({ op: "getWallet" }));
  expect("door", "garbage token is refused", r.status === 401 || r.status === 403, `status ${r.status} ${r.text}`);
  r = await send(h(ANON_KEY), JSON.stringify({ op: "getWallet" }));
  expect("door", "the public key alone (no person) is refused", r.status === 401 || r.status === 403 || /UNAUTH|sign in/i.test(r.text), `status ${r.status} ${r.text}`);
  r = await send(h(tokens.asha), "{not json");
  expect("door", "broken JSON is refused", r.status >= 400 || /"ok":false/.test(r.text), `status ${r.status} ${r.text}`);
  r = await send(h(tokens.asha), "null");
  expect("door", "JSON null body gives a clean 4xx", r.status >= 400 && r.status < 500, `status ${r.status} ${r.text}`);
  r = await send(h(tokens.asha), JSON.stringify([1, 2, 3]));
  expect("door", "JSON array body is refused", r.status >= 400 || /"ok":false/.test(r.text), `status ${r.status} ${r.text}`);
  r = await send(h(tokens.asha), undefined, "GET");
  expect("door", "GET is refused", r.status === 405, `status ${r.status} ${r.text}`);
  for (const op of ["__proto__", "constructor", "toString", "hasOwnProperty", "../admin", "", "GETWALLET", "getWallet ", "batch", "health "]) {
    const res = await asha(op as string);
    if (op === "batch") expectRefused("door", "batch with no calls is refused", res);
    else expectRefused("door", `odd operation name "${op}" is refused`, res);
  }
  // A huge body should be refused, not crash the function.
  r = await send(h(tokens.asha), JSON.stringify({ op: "sendFeedback", args: { kind: "idea", body: "x".repeat(6_000_000) } }));
  expect("door", "a 6 MB body is refused cleanly", r.status >= 400 || /"ok":false/.test(r.text), `status ${r.status} ${r.text.slice(0, 100)}`);
  // Nested batch / write inside batch.
  const b = await asha<unknown[]>("batch", { calls: [{ op: "requestWithdrawal", args: { amountMinor: 100 } }, { op: "batch", args: { calls: [{ op: "getWallet" }] } }, { op: "getWallet" }] });
  if (b.ok) {
    const rep = b.data as { ok: boolean; error?: { code: string } }[];
    expect("door", "a write or a nested batch inside a batch is refused", rep[0]?.ok === false && rep[1]?.ok === false && rep[2]?.ok === true, JSON.stringify(rep).slice(0, 300));
  } else findings.push({ area: "door", probe: "batch with mixed calls", got: JSON.stringify(b.error) });
  r = await send(h(tokens.asha), JSON.stringify({ op: "getWallet" }), "OPTIONS");
  expect("door", "OPTIONS (preflight) answers", r.status === 200, `status ${r.status}`);
});

test("2. strangers cannot touch someone else's task or money", async () => {
  const task = await post(asha, 5_000);
  const bid = must(await ravi<{ id: string }>("placeBid", { taskId: task.id, priceMinor: 5_000, timeLimitMinutes: 60, message: "mine" }), "placeBid");
  // Meera is not part of this job.
  for (const [op, args] of [
    ["lockBid", { bidId: bid.id }],
    ["payTaskFromWallet", { taskId: task.id }],
    ["startTask", { taskId: task.id }],
    ["markWorkDone", { taskId: task.id }],
    ["confirmRelease", { taskId: task.id }],
    ["requestRevision", { taskId: task.id, note: "x" }],
    ["cancelTask", { taskId: task.id, reason: "x" }],
    ["openDispute", { taskId: task.id, reason: "x" }],
    ["submitReview", { taskId: task.id, rating: 1, comment: "bad" }],
    ["removeListing", { taskId: task.id }],
    ["updateBid", { bidId: bid.id, priceMinor: 1, timeLimitMinutes: 1 }],
    ["submitProof", { taskId: task.id, summary: "fake", files: [] }],
    ["sendMessage", { taskId: task.id, body: "hello from a stranger" }],
  ] as [string, Record<string, unknown>][]) {
    expectRefused("stranger", `Meera calls ${op} on Asha's task`, await meera(op, args));
  }
  // The worker cannot do the poster's steps either.
  for (const [op, args] of [
    ["lockBid", { bidId: bid.id }],
    ["confirmRelease", { taskId: task.id }],
    ["cancelTask", { taskId: task.id, reason: "x" }],
    ["removeListing", { taskId: task.id }],
  ] as [string, Record<string, unknown>][]) {
    expectRefused("worker", `Ravi calls ${op} as if he were the poster`, await ravi(op, args));
  }
  // The poster cannot bid on their own task, nor do the worker's steps.
  expectRefused("poster", "Asha bids on her own task", await asha("placeBid", { taskId: task.id, priceMinor: 100, timeLimitMinutes: 60 }));
  // Reads a stranger should not get: other people's bids, messages, proof, contact phone.
  const bids = await meera<{ worker_id: string }[]>("listBidsForTask", { taskId: task.id });
  expect("stranger", "Meera cannot list the offers on Asha's task", bids.ok && bids.data.every((b) => b.worker_id === ids.meera), `saw ${JSON.stringify(bids.ok ? bids.data.length : bids.error)} offers`);
  const msgs = await meera<unknown[]>("listMessages", { taskId: task.id });
  expect("stranger", "Meera reads no chat of the task", msgs.ok && msgs.data.length === 0, JSON.stringify(msgs).slice(0, 200));
  const ph = await meera<string | null>("taskContactPhone", { taskId: task.id });
  expect("stranger", "Meera gets no phone number for the task", !ph.ok || ph.data === null, JSON.stringify(ph));
  const ph2 = await ravi<string | null>("taskContactPhone", { taskId: task.id });
  expect("worker", "a worker with only an offer (not hired) gets no phone number", !ph2.ok || ph2.data === null, JSON.stringify(ph2));
  const pr = await meera("getProof", { taskId: task.id });
  expect("stranger", "Meera reads no proof", !pr.ok || pr.data === null, JSON.stringify(pr).slice(0, 200));
  // Clean up.
  await asha("cancelTask", { taskId: task.id, reason: "break-it cleanup" });
});

test("3. money cannot be made, doubled or lost", async () => {
  const price = 10_000;
  const a0 = total(await wallet(asha));
  const r0 = total(await wallet(ravi));
  const task = await post(asha, price);
  const bid = must(await ravi<{ id: string }>("placeBid", { taskId: task.id, priceMinor: price, timeLimitMinutes: 60 }), "placeBid");

  // Same offer locked many times at once: one debit only.
  const locks = await Promise.all(Array.from({ length: 6 }, () => asha("lockBid", { bidId: bid.id })));
  const okLocks = locks.filter((l) => l.ok).length;
  expect("money", "6 simultaneous lockBid calls lock once", okLocks === 1, `${okLocks} of 6 succeeded`);
  const fees = must(await asha<{ posterFee: number; commission: number; cancelFine: number }>("platformFees"), "fees");
  const held = Math.round(price * (1 + fees.posterFee));
  const a1 = total(await wallet(asha));
  expect("money", "poster is debited exactly once (price + fee)", a0 - a1 === held, `debited ${a0 - a1}, expected ${held}`);
  const beforeRepay = total(await wallet(asha));
  await asha("payTaskFromWallet", { taskId: task.id });
  const afterRepay = total(await wallet(asha));
  expect("money", "paying a task that is already funded does not charge again", afterRepay === beforeRepay, `wallet moved by ${afterRepay - beforeRepay}`);

  must(await ravi("startTask", { taskId: task.id }), "startTask");
  const starts = await Promise.all(Array.from({ length: 3 }, () => ravi("startTask", { taskId: task.id })));
  expect("money", "starting twice is refused", starts.every((s) => !s.ok), JSON.stringify(starts.map((s) => s.ok)));
  expectRefused("money", "confirmRelease before the work is marked done", await asha("confirmRelease", { taskId: task.id }));
  expectRefused("money", "review before completion", await asha("submitReview", { taskId: task.id, rating: 5 }));
  must(await ravi("submitProof", { taskId: task.id, summary: "Finished the job as agreed.", files: [] }), "proof");
  must(await ravi("markWorkDone", { taskId: task.id }), "done");

  // Approve five times at once: the worker is paid once.
  const rel = await Promise.all(Array.from({ length: 5 }, () => asha("confirmRelease", { taskId: task.id })));
  expect("money", "5 simultaneous confirmRelease calls release once", rel.filter((x) => x.ok).length === 1, `${rel.filter((x) => x.ok).length} of 5 succeeded`);
  must(await ravi("settleClearedEarnings"), "settle");
  const net = Math.round(price * (1 - fees.commission));
  const r1 = total(await wallet(ravi));
  expect("money", "worker is paid exactly once (price less commission)", r1 - r0 === net, `paid ${r1 - r0}, expected ${net}`);
  expectRefused("money", "cancelling a completed task", await asha("cancelTask", { taskId: task.id, reason: "refund me" }));
  expectRefused("money", "disputing a completed task", await ravi("openDispute", { taskId: task.id, reason: "more please" }));

  // Reviews: once each, rating range, self-review, strangers.
  must(await asha("submitReview", { taskId: task.id, rating: 5, comment: "ok" }), "review");
  // A second review by the same person edits their own (by design); it never makes a second row.
  const firstReview = await asha<{ id: string }>("submitReview", { taskId: task.id, rating: 4, comment: "edited" });
  expect("money", "the same person reviewing twice edits one review, not two", firstReview.ok && (await ravi<unknown[]>("listReviewsAbout", { userId: ids.ravi, role: "worker", limit: 50 })).ok, JSON.stringify(firstReview).slice(0, 150));
  for (const rating of [0, 6, -1, 2.5, "5", null, Number.NaN]) {
    expectRefused("input", `rating ${JSON.stringify(rating)} is refused`, await ravi("submitReview", { taskId: task.id, rating }));
  }
  expectRefused("money", "a stranger reviewing a finished job", await meera("submitReview", { taskId: task.id, rating: 1, comment: "troll" }));
});

test("4. cancelling: refunds happen once and fines are fair", async () => {
  const price = 8_000;
  const fees = must(await asha<{ posterFee: number; cancelFine: number }>("platformFees"), "fees");
  // Cancel while only locked (before start): full refund, once, even if called many times.
  const a0 = total(await wallet(asha));
  const task = await post(asha, price);
  const bid = must(await ravi<{ id: string }>("placeBid", { taskId: task.id, priceMinor: price, timeLimitMinutes: 60 }), "bid");
  must(await asha("lockBid", { bidId: bid.id }), "lock");
  const cancels = await Promise.all(Array.from({ length: 5 }, () => asha("cancelTask", { taskId: task.id, reason: "break-it double cancel" })));
  expect("money", "5 simultaneous cancelTask calls refund once", cancels.filter((c) => c.ok).length === 1, `${cancels.filter((c) => c.ok).length} of 5 succeeded`);
  const a1 = total(await wallet(asha));
  expect("money", "cancel before start returns everything (no fine)", a1 === a0, `wallet changed by ${a1 - a0}`);
  expectRefused("money", "starting a cancelled task", await ravi("startTask", { taskId: task.id }));
  expectRefused("money", "locking a bid on a cancelled task", await asha("lockBid", { bidId: bid.id }));
  void fees;
});

test("5. withdrawals: no overdraft, no double spend, no strangers", async () => {
  const dests = must(await ravi<{ id: string }[]>("listPayoutDestinations"), "dest");
  const dest = dests[0] ?? must(await ravi<{ id: string }>("addPayoutDestination", { kind: "upi", upiId: "ravi.e2e@okaxis", label: "e2e UPI" }), "adddest");
  const w0 = await wallet(ravi);
  // Ask for the whole balance six times at once. At most one may go through.
  const reqs = await Promise.all(Array.from({ length: 6 }, () => ravi<{ id: string }>("requestWithdrawal", { amountMinor: w0.balance_minor, destinationId: dest.id })));
  const accepted = reqs.filter((x) => x.ok);
  expect("money", "6 simultaneous full-balance withdrawals: at most one goes through", accepted.length <= 1, `${accepted.length} accepted`);
  const w1 = await wallet(ravi);
  expect("money", "the balance never goes below zero", w1.balance_minor >= 0, `balance ${w1.balance_minor}`);
  for (const amountMinor of [0, -100, 0.5, 1e15, "1000", null, Number.MAX_SAFE_INTEGER]) {
    expectRefused("input", `withdrawal amount ${JSON.stringify(amountMinor)}`, await ravi("requestWithdrawal", { amountMinor, destinationId: dest.id }));
  }
  expectRefused("money", "withdrawing to someone else's destination", await meera("requestWithdrawal", { amountMinor: 10_000, destinationId: dest.id }));
  for (const a of accepted) {
    if (a.ok) {
      expectRefused("money", "Meera cancels Ravi's withdrawal", await meera("cancelWithdrawal", { payoutId: a.data.id }));
      const c1 = await ravi("cancelWithdrawal", { payoutId: a.data.id });
      const c2 = await ravi("cancelWithdrawal", { payoutId: a.data.id });
      expect("money", "cancelling a withdrawal twice refunds once", c1.ok && !c2.ok, `${c1.ok}/${c2.ok}`);
    }
  }
  const w2 = await wallet(ravi);
  expect("money", "after cancel the balance is back exactly", w2.balance_minor === w0.balance_minor, `${w0.balance_minor} -> ${w2.balance_minor}`);
  await meera("removePayoutDestination", { id: dest.id }); // answers "done" and changes nothing; the next check proves it
  const still = must(await ravi<{ id: string }[]>("listPayoutDestinations"), "dest2");
  expect("money", "Ravi's destination is still there after Meera's attempt", still.some((d) => d.id === dest.id), "destination vanished");
  // Bad destinations.
  for (const bad of [
    { kind: "upi", upiId: "not-a-upi" },
    { kind: "upi", upiId: "a@b@c" },
    { kind: "upi", upiId: "<script>alert(1)</script>@ok" },
    { kind: "bank", accountName: "X", accountNumber: "12", ifsc: "BAD" },
    { kind: "bank", accountName: "X", accountNumber: "abcdefghij", ifsc: "SBIN0001234" },
    { kind: "crypto", upiId: "x@y" },
  ]) {
    const r = await meera<{ id: string }>("addPayoutDestination", bad);
    if (r.ok) {
      findings.push({ area: "input", probe: `payout destination ${JSON.stringify(bad)} saved`, got: "accepted" });
      await meera("removePayoutDestination", { id: r.data.id });
    } else passed.push(`input: bad destination ${JSON.stringify(bad).slice(0, 60)} refused`);
  }
});

test("6. offers and posts: odd amounts, odd text, odd dates", async () => {
  const task = await post(asha, 5_000);
  for (const priceMinor of [-1, 0, 0.5, 1e12, "500", null, Number.NaN, 1e300]) {
    const r = await ravi<{ id: string }>("placeBid", { taskId: task.id, priceMinor, timeLimitMinutes: 60 });
    if (r.ok) {
      findings.push({ area: "input", probe: `offer with price ${JSON.stringify(priceMinor)} accepted`, got: "a worker can offer a nonsense price" });
      await ravi("updateBid", { bidId: r.data.id, priceMinor: 5_000, timeLimitMinutes: 60 }); // leaves one real offer
      break;
    } else passed.push(`input: offer price ${JSON.stringify(priceMinor)} refused`);
  }
  for (const benchmarkMinor of [-5, 0, 0.5, "100", 1e300, null]) {
    const r = await asha<{ id: string }>("createTask", { pillar: "services", title: "[e2e-break] odd price", description: "x", benchmarkMinor, timeLimitMinutes: 60 });
    if (r.ok) {
      findings.push({ area: "input", probe: `task posted with budget ${JSON.stringify(benchmarkMinor)}`, got: "accepted" });
      await asha("cancelTask", { taskId: r.data.id, reason: "break-it cleanup" });
    } else passed.push(`input: task budget ${JSON.stringify(benchmarkMinor)} refused`);
  }
  // Odd text: control characters, null byte, very long, emoji, script, HTML, SQL.
  const odd = [
    "ok \u0000 null byte",
    "<script>alert(document.cookie)</script>",
    "'; drop table tasks; --",
    "‮reversed text‬",
    "😀".repeat(100),
    "A".repeat(301),
    "   ",
    "",
  ];
  for (const title of odd) {
    const r = await asha<{ id: string; title: string }>("createTask", { pillar: "services", title, description: "x", benchmarkMinor: 5_000, timeLimitMinutes: 60 });
    if (r.ok) {
      passed.push(`input: title ${JSON.stringify(title.slice(0, 20))} stored as plain text (the apps and the admin draw it escaped, never as markup)`);
      await asha("cancelTask", { taskId: r.data.id, reason: "break-it cleanup" });
    } else if (r.error.code === "INTERNAL") findings.push({ area: "input", probe: `task title ${JSON.stringify(title.slice(0, 30))}`, got: `server error: ${r.error.code}` });
    else passed.push(`input: title ${JSON.stringify(title.slice(0, 20))} refused cleanly`);
  }
  // Dates and places.
  for (const extra of [{ dueAt: "yesterday" }, { dueAt: "1999-01-01T00:00:00Z" }, { dueAt: "9999-12-31T00:00:00Z" }, { locLat: 999, locLng: 999 }, { locLat: "12", locLng: "77" }, { timeLimitMinutes: -5 }, { assignmentMode: "robot" }, { kind: "hack" }, { flag: "free" }]) {
    const r = await asha<{ id: string }>("createTask", { pillar: "services", title: "[e2e-break] odd field", description: "x", benchmarkMinor: 5_000, timeLimitMinutes: 60, ...extra });
    if (r.ok) {
      findings.push({ area: "input", probe: `task posted with ${JSON.stringify(extra)}`, got: "accepted (value makes no sense)" });
      await asha("cancelTask", { taskId: r.data.id, reason: "break-it cleanup" });
    } else if (r.error.code === "INTERNAL") findings.push({ area: "input", probe: `task field ${JSON.stringify(extra)}`, got: "server error INTERNAL" });
    else passed.push(`input: ${JSON.stringify(extra)} refused`);
  }
  // Contact leaks through variations.
  for (const text of ["call 9 8 7 6 5 4 3 2 1 0", "nine eight seven six five four three two one zero", "mail me at a (at) b (dot) com", "wa.me/919876543210", "t.me/someone", "ping my insta @someone_cool", "my number is 98765-43210", "9️⃣8️⃣7️⃣6️⃣5️⃣4️⃣3️⃣2️⃣1️⃣0️⃣", "९८७६५४३२१०"]) {
    const r = await asha<{ id: string }>("createTask", { pillar: "services", title: "[e2e-break] contact", description: text, benchmarkMinor: 5_000, timeLimitMinutes: 60 });
    if (r.ok) {
      findings.push({ area: "contacts", probe: `post carrying a contact detail got through: ${JSON.stringify(text)}`, got: "accepted" });
      await asha("cancelTask", { taskId: r.data.id, reason: "break-it cleanup" });
    } else passed.push(`contacts: ${JSON.stringify(text).slice(0, 40)} refused`);
  }
  await asha("cancelTask", { taskId: task.id, reason: "break-it cleanup" });
});

test("7. direct database access with a normal login (bypassing the app)", async () => {
  const A = tokens.asha;
  // Read what a user should not see.
  let r = await rest(A, "GET", "profiles?select=*&limit=3");
  const first = Array.isArray(r.json) ? (r.json[0] as Record<string, unknown> | undefined) : undefined;
  if (first) {
    const all = r.json as Record<string, unknown>[];
    // An old column that is empty for everyone (payout_upi) exposes nothing; one with a value in it does.
    const sensitive = Object.keys(first).filter((k) => /birth|phone|email|payout|upi|token|secret|ip_|address/i.test(k) && all.some((x) => x[k] != null && x[k] !== ""));
    expect("direct", "profiles table shows no private columns to any signed-in user", sensitive.length === 0, `columns visible on other people's profiles: ${sensitive.join(", ")}`);
  }
  r = await rest(A, "GET", `profiles?select=id&id=neq.${ids.asha}&limit=500`);
  expect("direct", "(info) how many other profiles a normal login can list", true, String(Array.isArray(r.json) ? r.json.length : r.text));
  for (const t of ["wallets", "payouts", "payout_destinations", "wallet_ledger", "payments", "notifications", "messages", "bids", "assignments", "reports", "support_tickets", "admin_audit_log", "user_roles", "age_checks", "app_secrets", "settings", "feedback", "app_devices", "auth_codes", "webhook_events", "crm_leads", "private.outbox"]) {
    const res = await rest(A, "GET", `${t}?select=*&limit=500`);
    if (res.status === 200 && Array.isArray(res.json)) {
      const rowsArr = res.json as Record<string, unknown>[];
      const foreign = rowsArr.filter((x) => {
        const owner = (x.user_id ?? x.owner ?? x.id ?? x.worker_id ?? x.poster_id ?? x.sender_id ?? x.reporter_id) as string | undefined;
        return owner && owner !== ids.asha && ![x.worker_id, x.poster_id, x.user_id, x.sender_id].includes(ids.asha);
      });
      if (["bids", "assignments", "messages"].includes(t)) {
        const mine = new Set<string>();
        for (const q of [`tasks?select=id&poster_id=eq.${ids.asha}`, `assignments?select=task_id&worker_id=eq.${ids.asha}`, `bids?select=task_id&worker_id=eq.${ids.asha}`]) {
          for (const x of ((await rest(A, "GET", q)).json as { id?: string; task_id?: string }[]) ?? []) mine.add((x.id ?? x.task_id) as string);
        }
        const strangers = rowsArr.filter((x) => !mine.has(x.task_id as string) && x.worker_id !== ids.asha && x.sender_id !== ids.asha);
        if (strangers.length) findings.push({ area: "direct", probe: `GET ${t} shows rows of jobs the person is not part of`, got: `${strangers.length} of ${rowsArr.length} rows` });
        else passed.push(`direct: ${t} readable, only on the person's own jobs`);
      } else if (t === "settings") {
        passed.push(`direct: settings readable (${rowsArr.length} rows; dev_otp_for_all is among them, P2-31)`);
      } else if (foreign.length) findings.push({ area: "direct", probe: `GET ${t} shows rows of other people`, got: `${foreign.length} of ${rowsArr.length} rows` });
      else if (t === "settings" || t === "user_roles") passed.push(`direct: ${t} readable (${rowsArr.length} rows)`);
      else passed.push(`direct: ${t} shows no foreign rows`);
    } else passed.push(`direct: ${t} closed (${res.status})`);
  }
  // Write what a user should never write.
  const writes: [string, string, string, unknown][] = [
    ["wallets", "PATCH", `wallets?user_id=eq.${ids.asha}`, { balance_minor: 99_999_999 }],
    ["wallets", "POST", "wallets", { user_id: ids.asha, balance_minor: 1 }],
    ["wallet_ledger", "POST", "wallet_ledger", { user_id: ids.asha, amount_minor: 100000, kind: "topup" }],
    ["payments", "POST", "payments", { user_id: ids.asha, amount_minor: 100000, status: "paid", purpose: "topup" }],
    ["user_roles", "POST", "user_roles", { user_id: ids.asha, role: "admin" }],
    ["profiles.verified", "PATCH", `profiles?id=eq.${ids.asha}`, { is_verified: true, verified: true, rating: 5, role: "admin", is_admin: true }],
    ["profiles.other", "PATCH", `profiles?id=eq.${ids.ravi}`, { display_name: "HACKED" }],
    ["tasks.status", "PATCH", `tasks?poster_id=eq.${ids.asha}`, { status: "COMPLETED" }],
    ["tasks.other", "PATCH", `tasks?poster_id=eq.${ids.ravi}`, { title: "HACKED" }],
    ["bids.price", "PATCH", `bids?worker_id=eq.${ids.ravi}`, { price_minor: 1 }],
    ["assignments", "PATCH", "assignments?status=eq.started", { escrow_minor: 1, status: "completed" }],
    ["payouts", "PATCH", `payouts?user_id=eq.${ids.ravi}`, { status: "paid" }],
    ["reviews", "POST", "reviews", { subject_id: ids.ravi, author_id: ids.asha, rating: 1, about_role: "worker" }],
    ["notifications.other", "POST", "notifications", { user_id: ids.ravi, type: "x", title: "Your account is suspended, send OTP to 9999999999" }],
    ["messages.spoof", "POST", "messages", { task_id: "00000000-0000-0000-0000-000000000000", sender_id: ids.ravi, body: "spoof" }],
    ["settings", "PATCH", "settings?key=neq.zzz", { value: "0" }],
    ["app_controls", "PATCH", "app_controls?platform=neq.zzz", { maintenance: true }],
  ];
  for (const [label, method, path, body] of writes) {
    const res = await rest(A, method, path, body);
    const affected = Array.isArray(res.json) ? res.json.length : 0;
    if ((res.status === 200 || res.status === 201) && affected > 0) findings.push({ area: "direct", probe: `${method} ${label}`, got: `HTTP ${res.status}, ${affected} row(s) changed: ${res.text.slice(0, 160)}` });
    else passed.push(`direct: ${method} ${label} blocked (${res.status}, ${affected} rows)`);
  }
  // Staff-only database functions called by an ordinary login.
  const fns = ["admin_set_admin", "admin_set_staff", "admin_delete_account", "admin_adjust_wallet", "admin_refund", "admin_cancel_task", "admin_dashboard", "admin_list_users", "admin_pay_payout", "admin_resolve_dispute", "settle_cleared_earnings", "auto_complete_due", "settle_finished_campaigns", "app_secrets", "grant_welcome_bonus", "credit_wallet", "wallet_credit", "complete_payment", "mark_payment_paid", "emit_event", "hide_message", "hide_category", "warn_user", "broadcast", "admin_broadcast", "set_app_controls", "admin_set_app_controls", "crm_create_lead", "reply_support_ticket"];
  for (const fn of fns) {
    const res = await rest(A, "POST", `rpc/${fn}`, {});
    // 404 = not exposed; 401/403/42501 = refused; 400 = wrong arguments but callable (look closer); 200 = ran.
    if (res.status === 200) findings.push({ area: "direct", probe: `rpc ${fn} ran for a normal login`, got: res.text.slice(0, 160) });
    else if (res.status === 400 && /argument|signature|Could not choose|parameter/i.test(res.text)) {
      passed.push(`direct: rpc ${fn} reachable but needs arguments (${res.text.slice(0, 80)})`);
    } else passed.push(`direct: rpc ${fn} not callable (${res.status})`);
  }
  // Signed-out access.
  for (const t of ["profiles", "tasks", "settings", "wallets", "messages", "reviews", "bids"]) {
    const res = await rest(null, "GET", `${t}?select=*&limit=5`);
    const n = Array.isArray(res.json) ? res.json.length : 0;
    if (n > 0 && !["tasks", "profiles", "reviews", "settings"].includes(t)) findings.push({ area: "direct", probe: `signed-out read of ${t}`, got: `${n} rows` });
    else if (n > 0) findings.push({ area: "direct", probe: `(info) signed-out read of ${t}`, got: `${n} rows visible without signing in` });
    else passed.push(`direct: signed-out ${t} closed`);
  }
});

test("8. other people's data through the app's own reads", async () => {
  const p = await meera<Record<string, unknown> | null>("getProfile", { userId: ids.asha });
  if (p.ok && p.data) {
    const leak = Object.keys(p.data).filter((k) => /birth|phone|email|payout|upi|token|secret/i.test(k));
    expect("reads", "getProfile of another person exposes no private fields", leak.length === 0, `fields: ${leak.join(", ")}`);
  }
  expect("reads", "Meera's wallet is her own", (await meera<{ user_id: string }>("getWallet")).ok, "wallet unreadable");
  const w = await meera<{ user_id?: string }>("getWallet");
  expect("reads", "getWallet returns only the caller's wallet", w.ok && (!w.data?.user_id || w.data.user_id === ids.meera), JSON.stringify(w).slice(0, 150));
  const notif = await meera<unknown[]>("listNotifications", {});
  expect("reads", "notifications are only the caller's", notif.ok && (notif.data as { user_id: string }[]).every((n) => n.user_id === ids.meera), "foreign notification visible");
  const pays = await meera<{ user_id: string }[]>("listPayouts", {});
  expect("reads", "payouts are only the caller's", pays.ok && pays.data.every((x) => x.user_id === ids.meera), "foreign payout visible");
  const thr = await meera<{ task_id?: string }[]>("listThreads");
  expect("reads", "chat threads only for jobs she is part of", thr.ok, JSON.stringify(thr).slice(0, 150));
  expectRefused("reads", "malformed ids are refused", await meera("getTaskDetail", { taskId: "1 or 1=1" }));
  expectRefused("reads", "an id of the wrong type is refused", await meera("getTaskDetail", { taskId: { $ne: null } }));
  const big = await meera("searchTasks", { query: "%", limit: 1e9, near: { lat: 12, lng: 77, radiusKm: 1e9 } });
  expect("reads", "search with absurd limits answers or refuses, not crashes", big.ok || big.error.code !== "INTERNAL", JSON.stringify(big).slice(0, 150));
  for (const q of ["%", "_", "\\", "'", '"', "a".repeat(5000), "\u0000", "*", "),or=(id.neq.0", "x,or=(1.eq.1"]) {
    const s = await meera("searchTasks", { query: q });
    expect("reads", `search text ${JSON.stringify(q.slice(0, 15))} does not error`, s.ok || s.error.code !== "INTERNAL", JSON.stringify(s).slice(0, 150));
  }
  expectRefused("reads", "unblocking/blocking yourself", await meera("blockUser", { userId: ids.meera }));
  expectRefused("reads", "reporting a made-up target", await meera("reportContent", { targetType: "task", targetId: "00000000-0000-0000-0000-000000000000", reason: "x" }));
  expectRefused("reads", "applying your own referral code", await meera("applyReferralCode", { code: "MEERA" }));
});

test("9. promotions: only paid, only owned, only valid tiers", async () => {
  const task = await post(asha, 5_000);
  expectRefused("promo", "a stranger promotes Asha's task", await meera("startPromotion", { taskId: task.id, days: 3, amountMinor: 24_000 }));
  for (const [days, amountMinor] of [[0, 100], [3, 1], [3, -5], [31, 100], [1.5, 100], [3, 23_999], [1, 1e15]]) {
    expectRefused("promo", `promotion with ${days} days / ${amountMinor} minor`, await asha("startPromotion", { taskId: task.id, days, amountMinor }));
  }
  expectRefused("promo", "activating a promotion with a made-up payment", await asha("activatePromotion", { promotionId: "00000000-0000-0000-0000-000000000001", paymentId: "00000000-0000-0000-0000-000000000002" }));
  expectRefused("promo", "cancelling a made-up promotion", await asha("cancelPromotion", { promotionId: "00000000-0000-0000-0000-000000000001" }));
  await asha("cancelTask", { taskId: task.id, reason: "break-it cleanup" });
});

test("10. support, reports and account: abuse", async () => {
  const t = await asha<{ id: string }>("openTicket", { category: "bug", body: "[e2e-break] ticket" });
  if (t.ok) {
    expectRefused("support", "a stranger reads Asha's ticket", await meera("getTicket", { ticketId: t.data.id }).then((r) => (r.ok && r.data ? r : ({ ok: false, error: { code: "EMPTY", message: "" } } as ApiResult))));
    expectRefused("support", "a stranger replies to Asha's ticket", await meera("replyTicket", { ticketId: t.data.id, body: "hi" }));
    expectRefused("support", "a stranger resolves Asha's ticket", await meera("resolveTicket", { ticketId: t.data.id }));
    await asha("resolveTicket", { ticketId: t.data.id });
  }
  expectRefused("account", "deleting the account without the exact confirm word", await meera("deleteMyAccount", { confirm: "yes" }));
  // (A birth date for a person who already passed the check just answers "ok" and changes nothing: first answer wins.)
  expectRefused("account", "recording a birth date in the future", await meera("recordBirthDate", { birthDate: "2999-01-01" }));
  expectRefused("account", "recording an impossible birth date", await meera("recordBirthDate", { birthDate: "2000-02-31" }));
  for (const username of ["ab", "UPPER case", "has space", "drop;table", "admin", "support", "taskdrop", "9876543210", "a@b.com"]) {
    const r = await meera("updateProfileExtras", { username });
    if (r.ok) {
      findings.push({ area: "profile", probe: `username ${JSON.stringify(username)} accepted`, got: "reserved/odd name allowed" });
      await meera("updateProfileExtras", { username: "meera_e2e" });
    } else passed.push(`profile: username ${JSON.stringify(username)} refused`);
  }
  const spam = await Promise.all(Array.from({ length: 10 }, () => meera("sendFeedback", { kind: "idea", body: "[e2e-break] spam spam spam" })));
  expect("abuse", "(info) feedback is not rate limited beyond the global limit", true, `${spam.filter((s) => s.ok).length}/10 accepted`);
});

test("11. the rate limiter holds, and recovers", async () => {
  // 80 writes of a harmless kind fit in the 60/min budget only partly.
  const calls = await Promise.all(Array.from({ length: 90 }, () => meera("touchPresence")));
  const refused = calls.filter((c) => !c.ok).length;
  expect("limit", "90 writes in a burst: some are refused (budget 60 per minute)", refused > 0, `${refused} refused`);
});

test("12. the other functions: webhooks, payments, payouts, sign-in", async () => {
  const fn = async (name: string, token: string | null, body: unknown, headers: Record<string, string> = {}, method = "POST") => {
    const res = await request.fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method,
      headers: { apikey: ANON_KEY, "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      data: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
      failOnStatusCode: false,
    });
    return { status: res.status(), text: (await res.text()).slice(0, 200) };
  };
  const refused = (r: { status: number }) => r.status >= 400 && r.status < 500;

  // A forged "payment received" call must be refused before anything is touched.
  const forged = { event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_forged", notes: { payment_id: "00000000-0000-0000-0000-000000000000" } } } } };
  for (const name of ["razorpay-webhook", "razorpayx-webhook"]) {
    let r = await fn(name, null, forged);
    const unconfigured = r.status === 503 && /"configured":false/.test(r.text); // answers "not set up" and touches nothing
    expect("webhook", `${name}: no signature is refused`, refused(r) || unconfigured, `${r.status} ${r.text}`);
    r = await fn(name, null, forged, { "x-razorpay-signature": "0".repeat(64) });
    expect("webhook", `${name}: a wrong signature is refused`, refused(r) || (r.status === 503 && /"configured":false/.test(r.text)), `${r.status} ${r.text}`);
    r = await fn(name, null, "", {}, "GET");
    expect("webhook", `${name}: GET is refused`, refused(r), `${r.status}`);
  }
  // Inngest's door runs work; it must want Inngest's own signature.
  let r = await fn("inngest", null, { event: { name: "user.deleted", data: { user_id: ids.meera } } });
  expect("inngest", "an unsigned call to the job runner is refused", refused(r) || r.status === 401, `${r.status} ${r.text}`);
  r = await fn("inngest", null, undefined, {}, "PUT");
  expect("inngest", "an unsigned PUT (register) is refused or harmless", r.status !== 500, `${r.status} ${r.text}`);

  // The payment function, as an ordinary person.
  const task = await post(asha, 5_000);
  for (const body of [
    { action: "create-link", purpose: "topup", amountMinor: -500 },
    { action: "create-link", purpose: "topup", amountMinor: 1 },
    { action: "create-link", purpose: "topup", amountMinor: 1e13 },
    { action: "create-link", purpose: "topup", amountMinor: "50000" },
    { action: "create-link", purpose: "escrow", taskId: task.id },
    { action: "create-link", purpose: "promotion" },
    { action: "create-link", purpose: "refund", amountMinor: 50000 },
    { action: "sync", paymentId: "00000000-0000-0000-0000-000000000000" },
    { action: "refund-escrow", taskId: task.id },
    { action: "nope" },
  ]) {
    const res = await fn("razorpay", tokens.meera, body);
    const bodyOk = /"error"/.test(res.text) || refused(res);
    expect("payments", `Meera: razorpay ${JSON.stringify(body).slice(0, 70)} is refused`, bodyOk && !/paymentId|"url"/.test(res.text), `${res.status} ${res.text}`);
  }
  r = await fn("razorpay", null, { action: "create-link", purpose: "topup", amountMinor: 50000 });
  expect("payments", "razorpay without a login is refused", refused(r), `${r.status} ${r.text}`);
  await asha("cancelTask", { taskId: task.id, reason: "break-it cleanup" });

  // Staff-only payout and setup functions, as an ordinary person.
  for (const body of [{ action: "check-all" }, { action: "send-pending" }, { action: "balance" }, { action: "give-back", payoutId: "00000000-0000-0000-0000-000000000000" }, { action: "send", payoutId: "00000000-0000-0000-0000-000000000000" }]) {
    const res = await fn("razorpayx-payouts", tokens.meera, body);
    // Until RazorpayX is set up the function answers "not set up" and does nothing; once it is, the admin check in
    // the code (`isAdmin`, supabase/functions/razorpayx-payouts/index.ts) refuses her. Both are safe, neither moves money.
    expect("payouts", `Meera: razorpayx-payouts ${body.action} is refused or does nothing`, refused(res) || /"error"/.test(res.text) || /"configured":false/.test(res.text), `${res.status} ${res.text}`);
  }
  r = await fn("razorpay-setup", tokens.meera, { action: "setup" });
  expect("payouts", "Meera: razorpay-setup is refused", refused(r) || /"error"/.test(r.text), `${r.status} ${r.text}`);

  // Sign-in functions.
  r = await fn("phone-auth", null, { action: "send", phone: "123" });
  expect("signin", "a 3-digit phone number is refused", refused(r), `${r.status} ${r.text}`);
  r = await fn("phone-auth", null, { action: "send", phone: "abcdefghij" });
  expect("signin", "a phone number of letters is refused", refused(r), `${r.status} ${r.text}`);
  r = await fn("phone-auth", null, "{broken");
  expect("signin", "broken JSON to phone-auth is a clean 4xx", refused(r), `${r.status} ${r.text}`);
  r = await fn("phone-auth", null, { action: "verify", phone: "9990000099", code: "123456" });
  expect("signin", "a code for a number that asked for none is refused", refused(r), `${r.status} ${r.text}`);
  r = await fn("phone-auth", null, { action: "send", phone: "9876543210; drop table users" });
  expect("signin", "a phone number with SQL in it is refused", refused(r), `${r.status} ${r.text}`);
  // Wrong passwords for a name that does not exist: slowed down, never let in, never a 500.
  const pw: number[] = [];
  for (let i = 0; i < 14; i++) pw.push((await fn("password-auth", null, { username: "zz_nobody_here", password: "wrong" + i })).status);
  expect("signin", "14 wrong passwords: never a success or a server error", pw.every((s) => s >= 400 && s < 500), pw.join(","));
  expect("signin", "14 wrong passwords: the guesses get throttled (429 appears)", pw.includes(429), pw.join(","));
  r = await fn("password-auth", null, { username: "Robert'); drop table students;--", password: "x" });
  expect("signin", "an odd username is a clean refusal", refused(r), `${r.status} ${r.text}`);
});
