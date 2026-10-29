// Counts the network requests the web app makes in its main flows, so a change that is meant to save calls
// can be checked against a number rather than a feeling. See docs/API_CALLS.md.
//
//   npm run web:export                                  # or: npx expo export -p web --output-dir <dir>
//   npx playwright test e2e/auth.setup.ts                # once, for the seed sessions in e2e/.auth
//   node scripts/count-api-calls.mjs [distDir] [--json out.json] [--idle 130] [--only cold,explore]
//
// It serves the exported build on port 8099 (the stored sessions are tied to that origin), signs in with the
// seed accounts' stored sessions (Asha hires, Ravi earns) and walks each flow in a phone-sized window. A flow's
// count is every request to the backend from the moment it starts until nothing new has gone out for a few
// seconds. Calls to the `api` function are listed by operation; a batch is one request carrying several.
// Read-only apart from presence and "seen" marks: it opens screens, it does not post, quote or pay.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const root = resolve(argv[0] && !argv[0].startsWith("--") ? argv[0] : "apps/mobile/dist");
const port = 8099;
const idleSeconds = Number(flag("idle", "0"));
const only = flag("only", "")?.split(",").filter(Boolean) ?? [];
const jsonOut = flag("json", "");
const verbose = argv.includes("--verbose");
const QUIET_MS = 3000;
const MAX_FLOW_MS = 30_000;

if (!existsSync(join(root, "index.html"))) throw new Error(`No web build in ${root}: run an Expo web export first.`);

const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".ico": "image/x-icon", ".ttf": "font/ttf", ".css": "text/css" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^[\\/]+/, "");
  let file = join(root, path);
  if (!(file + sep).startsWith(root + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port);
// --serve: only serve the build (for refreshing the stored sessions with e2e/auth.setup.ts against it).
if (argv.includes("--serve")) await new Promise(() => {});

/** What a request was, in a few words: `api getProfile`, `api batch[getProfile,listMyTasks]`, `app-config`, `rest settings`. */
function describe(req) {
  const u = new URL(req.url());
  if (u.hostname === "localhost") return null;
  const fn = u.pathname.match(/^\/functions\/v1\/([^/?]+)/)?.[1];
  if (fn === "api") {
    let body = {};
    try {
      body = JSON.parse(req.postData() ?? "{}");
    } catch {
      /* not JSON */
    }
    if (body.op === "batch") return { kind: "api", label: `api batch[${(body.args?.calls ?? []).map((c) => c.op).join(",")}]`, ops: (body.args?.calls ?? []).map((c) => c.op) };
    return { kind: "api", label: `api ${body.op ?? "?"}`, ops: [body.op ?? "?"] };
  }
  if (fn) return { kind: fn, label: fn, ops: [] };
  if (u.pathname.startsWith("/rest/v1/")) return { kind: "rest", label: `rest ${u.pathname.slice(9)}`, ops: [] };
  if (u.pathname.startsWith("/auth/v1/")) return { kind: "auth", label: `auth ${u.pathname.slice(9)}`, ops: [] };
  if (u.pathname.startsWith("/storage/v1/")) return { kind: "storage", label: "storage", ops: [] };
  if (u.hostname.endsWith("supabase.co")) return { kind: "supabase", label: u.pathname, ops: [] };
  return { kind: "other", label: u.hostname, ops: [] };
}

async function session(who) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    baseURL: `http://localhost:${port}`,
    storageState: `e2e/.auth/${who}.json`,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  // The tester card and the app tour would sit over the screens being counted.
  // Each person starts on their own side: Asha on Hire, Ravi on Earn.
  await context.addInitScript((mode) => {
    localStorage.setItem('taskdrop.stagingCardSeen', '1');
    localStorage.setItem('taskdrop.tourSeen', '1');
    localStorage.setItem('taskdrop.mode', mode);
  }, who === 'ravi' ? 'worker' : 'poster');
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  if (verbose) {
    page.on("console", (m) => m.type() !== "log" && console.log(`  [console ${m.type()}] ${m.text().slice(0, 240)}`));
    page.on("response", (r) => r.status() >= 400 && console.log(`  [${r.status()}] ${r.url().slice(0, 120)}`));
  }
  const seen = [];
  const entries = new Map();
  let last = Date.now();
  page.on("request", (req) => {
    const d = describe(req);
    if (!d) return;
    last = Date.now();
    const entry = { at: Date.now(), ...d };
    entries.set(req, entry);
    seen.push(entry);
  });
  // A refusal inside an answer (an op the server will not batch, a rule) is noted on the call, so a
  // saving that only "worked" because calls quietly failed shows up.
  page.on("response", async (res) => {
    const entry = entries.get(res.request());
    if (!entry || entry.kind !== "api") return;
    const body = await res.json().catch(() => null);
    const replies = Array.isArray(body?.data) && entry.label.startsWith("api batch") ? body.data : [body];
    const refused = replies.filter((r) => r && r.ok === false).map((r) => r.error?.code ?? "?");
    if (verbose) console.log(`  [answered after ${Date.now() - entry.at} ms] ${entry.label}`);
    if (res.status() >= 400 || refused.length) entry.label += `  !! ${res.status()} ${refused.join(",")}`;
  });
  page.on("websocket", (ws) => {
    if (!ws.url().includes("supabase.co")) return;
    last = Date.now();
    seen.push({ at: Date.now(), kind: "realtime", label: "realtime socket", ops: [] });
    ws.on("framesent", (f) => {
      const text = typeof f.payload === "string" ? f.payload : "";
      const event = text.match(/phx_join|phx_leave/)?.[0];
      if (event) seen.push({ at: Date.now(), kind: "realtime", label: `realtime ${event}`, ops: [] });
    });
  });
  /** Run one step and return what went out until things went quiet. */
  const flow = async (name, step) => {
    const from = seen.length;
    const started = Date.now();
    last = Date.now();
    await step(page);
    while (Date.now() - last < QUIET_MS && Date.now() - started < MAX_FLOW_MS) await page.waitForTimeout(250);
    return { name, started, requests: seen.slice(from) };
  };
  return { browser, page, flow, seen };
}

// Kept-alive tabs stay in the page while hidden, so every lookup takes the visible match.
const visible = (locator) => locator.filter({ visible: true }).first();
const tap = (page, text) => visible(page.getByText(text, { exact: true })).click();
const press = (page, label) => visible(page.getByLabel(label, { exact: true })).click();
/** Press the card a control sits on: a little to the left of it, where the card's own text is. */
async function pressCardOf(page, label) {
  const box = await visible(page.getByLabel(label, { exact: true })).boundingBox();
  if (!box) throw new Error(`no ${label} on screen`);
  await page.mouse.click(box.x - 120, box.y + box.height / 2);
}
/** The first card under the "N results" line of a list. */
async function pressFirstResult(page) {
  const box = await visible(page.getByText(/\d+ results?/)).boundingBox();
  if (!box) throw new Error("no results line on screen");
  await page.mouse.click(box.x + 150, box.y + box.height + 60);
}
const back = (page) => visible(page.getByLabel(/^(Back|Close)$/)).click();

function summarise({ name, started, requests }) {
  // Third-party requests (App Check's reCAPTCHA, fonts) are listed but not counted as backend calls.
  const http = requests.filter((r) => r.kind !== "realtime" && r.kind !== "other");
  const api = http.filter((r) => r.kind === "api");
  const byKind = {};
  for (const r of http) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  return {
    name,
    total: http.length,
    api: api.length,
    apiOps: api.reduce((n, r) => n + r.ops.length, 0),
    byKind,
    thirdParty: requests.filter((r) => r.kind === "other").length,
    realtime: requests.filter((r) => r.kind === "realtime").map((r) => r.label),
    // Each call with how long after the step began it left.
    calls: http.map((r) => `+${((r.at - started) / 1000).toFixed(1)}s ${r.label}`),
  };
}

const FLOWS = {
  // Asha hires.
  asha: [
    ["cold", (p) => p.goto("/")],
    ["composer", async (p) => {
      await visible(p.getByLabel("What do you need done?", { exact: true })).fill("Clean my kitchen this weekend");
      await press(p, "Continue");
    }],
    ["composerBack", async (p) => {
      await back(p);
      await tap(p, "Discard");
    }],
    ["explore", (p) => tap(p, "Explore")],
    ["myTasks", (p) => tap(p, "My Tasks")],
    ["openOwnTask", (p) => pressCardOf(p, "Task options")],
    ["backToMyTasks", back],
    ["inbox", (p) => press(p, "Messages")],
    ["openChat", (p) => p.mouse.click(195, 230)],
    ["backToInbox", back],
    ["notifications", async (p) => {
      await back(p);
      await visible(p.getByLabel(/^Notifications/)).click();
    }],
    ["wallet", async (p) => {
      await back(p);
      await tap(p, "Wallet");
    }],
    ["profile", (p) => tap(p, "Profile")],
    ["home", (p) => tap(p, "Home")],
  ],
  // Ravi earns.
  ravi: [
    ["cold", (p) => p.goto("/")],
    ["findWork", (p) => tap(p, "Explore")],
    ["openTask", pressFirstResult],
    ["backToFindWork", back],
    ["myWork", (p) => tap(p, "My Work")],
    ["profile", (p) => tap(p, "Profile")],
    ["home", (p) => tap(p, "Home")],
  ],
};

const results = [];
for (const [who, steps] of Object.entries(FLOWS)) {
  const s = await session(who);
  for (const [name, step] of steps) {
    if (only.length && !only.includes(`${who}.${name}`) && !only.includes(name)) continue;
    try {
      const r = summarise(await s.flow(`${who}.${name}`, step));
      results.push(r);
      console.log(`${r.name.padEnd(20)} ${String(r.total).padStart(3)} backend requests, ${r.api} to api carrying ${r.apiOps} ops  ${JSON.stringify(r.byKind)} +${r.thirdParty} third-party`);
      for (const c of r.calls) console.log(`    ${c}`);
      if (r.realtime.length) console.log(`    (${r.realtime.join(", ")})`);
    } catch (e) {
      console.log(`${who}.${name}: could not run (${e instanceof Error ? e.message.split("\n")[0] : e})`);
    }
    await s.page.screenshot({ path: `${process.env.SHOTS ?? "test-results"}/${who}-${name}.png` }).catch(() => {});
  }
  if (idleSeconds > 0 && who === "asha") {
    const from = s.seen.length;
    const started = Date.now();
    await s.page.waitForTimeout(idleSeconds * 1000);
    const r = summarise({ name: `${who}.idle${idleSeconds}s`, started, requests: s.seen.slice(from) });
    results.push(r);
    console.log(`${r.name.padEnd(20)} ${String(r.total).padStart(3)} requests  ${JSON.stringify(r.byKind)}`);
    for (const c of r.calls) console.log(`    ${c}`);
  }
  await s.browser.close();
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(results, null, 2));
server.close();
