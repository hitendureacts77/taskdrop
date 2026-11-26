import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Page, Request, Route } from "@playwright/test";

/**
 * Makes the look-only screenshot checks (desktopWeb.spec.ts) repeatable. The app shows live data and
 * time-based words ("15h left", "Last seen 7 days ago"), so a picture taken today never equals one taken
 * tomorrow, which would make a zero-pixel guard useless. Two things fix that:
 *
 *  1. Replay: every read the app makes to the TEST project's `api` function is answered from
 *     `e2e/fixtures/desktop-web-api.json`, recorded once with `DESKTOP_RECORD=1` from the seed account Meera
 *     (fake people, fake money). The file is kept per call (operation + arguments), not per request: the app
 *     sends reads together in a `batch` and which reads share a batch depends on timing, and the address of
 *     an operation (`/api` or `/api/<group>/<op>`) can change. A call that is not in the file goes to the live
 *     project and is counted as a miss (listed at the end of the run). Map tiles are not stored: the guard
 *     blocks them (the map is masked in its pictures); the 1440 pictures load them live.
 *  2. A browser clock that starts at the moment of recording, and short relative times ("3d left") are
 *     rewritten to a fixed word, so a few seconds of run time cannot flip "2m" to "3m".
 *
 * Nothing here writes to the project except what the app itself does on load (heartbeat), and those calls
 * are answered from the file too. Sign-in tokens (`/auth/v1/`) are never stored.
 */

export const RECORD = process.env.DESKTOP_RECORD === "1";
export const FIXTURE_FILE = resolve("e2e/fixtures/desktop-web-api.json");

/** One call's answer is `{ok, data}` or `{ok:false, error}`, exactly as the api sent it. */
type Fixture = { recordedAt: string; calls: Record<string, unknown> };
type Call = { op: string; args?: unknown };

/** Map tiles, styles, sprites and fonts. */
const MAP_HOST = /(^|\.)openfreemap\.org$/;
let liveTiles = false;
let profilePatch: Overrides["profile"];

// A record run adds to the file (workers restart after a failure); delete the file first for a clean recording.
const fixture: Fixture = existsSync(FIXTURE_FILE)
  ? (JSON.parse(readFileSync(FIXTURE_FILE, "utf8")) as Fixture)
  : { recordedAt: new Date().toISOString(), calls: {} };

const misses = new Set<string>();

function isProjectData(url: URL): boolean {
  return url.hostname.endsWith(".supabase.co") && (url.pathname.startsWith("/functions/v1/") || url.pathname.startsWith("/rest/v1/"));
}

const API_PATH = /^\/functions\/v1\/api(\/|$)/;
const callKey = (c: Call) => `${c.op} ${JSON.stringify(c.args ?? {})}`;

/** The call(s) a request to the api carries, or null if it is not one (or its body is not JSON). */
function callsOf(req: Request, url: URL): { batch: boolean; calls: Call[] } | null {
  if (!API_PATH.test(url.pathname) || req.method() !== "POST") return null;
  let body: { op?: string; args?: { calls?: Call[] } };
  try {
    body = JSON.parse(req.postData() ?? "") as typeof body;
  } catch {
    return null;
  }
  // /functions/v1/api/<group>/<op>: the op is the last segment; the old address has it in the body.
  const op = body.op ?? url.pathname.split("/").filter(Boolean).slice(3).pop();
  if (!op) return null;
  if (op === "batch") return Array.isArray(body.args?.calls) ? { batch: true, calls: body.args.calls } : null;
  return { batch: false, calls: [{ op, args: body.args ?? {} }] };
}

/** Signed links carry a token; the fixture is committed, so none is kept. */
function scrub<T>(value: T): T {
  const text = JSON.stringify(value)
    .replace(/([?&](?:token|X-Amz-Signature|signature|sig)=)[^"&\\\s]+/gi, "$1redacted")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, "redacted.jwt.value");
  return JSON.parse(text) as T;
}

const reply = (route: Route, body: unknown) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "*" },
    body: JSON.stringify(body),
  });

/** A copy of one call's answer with the setup fields nulled when the test asks to look like a new account. */
function patched(c: Call, answer: unknown): unknown {
  const a = answer as { ok?: boolean; data?: unknown } | undefined;
  if (!profilePatch || c.op !== "getProfile" || !a?.ok || !a.data || typeof a.data !== "object") return answer;
  return { ...a, data: { ...(a.data as object), ...profilePatch } };
}

async function handle(route: Route): Promise<void> {
  const req = route.request();
  const url = new URL(req.url());
  if (url.protocol === "data:" || url.protocol === "blob:") return route.continue();
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return route.continue();
  if (url.pathname.startsWith("/auth/v1/")) return route.continue();
  if (req.method() === "OPTIONS") return route.fallback();

  if (MAP_HOST.test(url.hostname)) return liveTiles && !RECORD ? route.continue() : route.abort();
  // Anything else on the internet (analytics, crash reports, a stray font) is not let out.
  if (!isProjectData(url)) return route.abort();

  const parsed = callsOf(req, url);
  if (!parsed) {
    // A plain GET to a function (app-config): kept whole, under its address. Anything else that cannot be keyed
    // (PostgREST, an unknown shape) is always live, and listed on replay.
    const raw = `GET ${url.pathname}${url.search}`;
    if (req.method() === "GET" && url.pathname.startsWith("/functions/v1/")) {
      if (RECORD) {
        const res = await route.fetch().catch(() => null);
        if (!res) return route.abort();
        const text = await res.text();
        if (res.ok()) fixture.calls[raw] = scrub({ raw: true, type: res.headers()["content-type"] ?? "application/json", text });
        return route.fulfill({ response: res, body: text });
      }
      const hit = fixture.calls[raw] as { raw: true; type: string; text: string } | undefined;
      if (hit) return route.fulfill({ status: 200, contentType: hit.type, headers: { "access-control-allow-origin": "*" }, body: hit.text });
    }
    if (!RECORD) misses.add(`${req.method()} ${url.pathname}`);
    return route.continue();
  }

  if (RECORD) {
    const res = await route.fetch().catch(() => null);
    if (!res) return route.abort();
    const text = await res.text();
    try {
      const got = JSON.parse(text) as { ok?: boolean; data?: unknown };
      if (parsed.batch && Array.isArray(got.data)) {
        const results = scrub(got.data as unknown[]);
        parsed.calls.forEach((c, i) => (fixture.calls[callKey(c)] = results[i]));
      }
      else if (!parsed.batch && got && typeof got === "object" && "ok" in got) fixture.calls[callKey(parsed.calls[0]!)] = scrub(got);
    } catch {
      /* not JSON: passed through, not stored */
    }
    if (!profilePatch) return route.fulfill({ response: res, body: text });
    try {
      const got = JSON.parse(text) as { ok?: boolean; data?: unknown };
      const out = parsed.batch && Array.isArray(got.data) ? { ...got, data: got.data.map((r, i) => patched(parsed.calls[i]!, r)) } : patched(parsed.calls[0]!, got);
      return reply(route, out);
    } catch {
      return route.fulfill({ response: res, body: text });
    }
  }

  const answers = parsed.calls.map((c) => patched(c, fixture.calls[callKey(c)]));
  if (parsed.calls.every((c) => fixture.calls[callKey(c)] !== undefined)) return reply(route, parsed.batch ? { ok: true, data: answers } : answers[0]);
  for (const c of parsed.calls) {
    if (fixture.calls[callKey(c)] === undefined) misses.add(`${c.op} ${JSON.stringify(c.args ?? {}).slice(0, 120)}`);
  }
  // A batch with some call the fixture does not know goes live, but the calls it does know keep their recorded
  // answer (so the person on screen is always the same one), and the profile patch applies to all of it.
  if (parsed.batch || profilePatch) {
    const res = await route.fetch().catch(() => null);
    if (!res) return route.abort();
    const text = await res.text();
    try {
      const got = JSON.parse(text) as { ok?: boolean; data?: unknown };
      if (parsed.batch && Array.isArray(got.data)) {
        const data = got.data.map((r, i) => {
          const c = parsed.calls[i]!;
          const known = fixture.calls[callKey(c)];
          return patched(c, known !== undefined ? known : r);
        });
        return reply(route, { ...got, data });
      }
      return reply(route, patched(parsed.calls[0]!, got));
    } catch {
      return route.fulfill({ response: res, body: text });
    }
  }
  return route.continue();
}

/** Run once after the last test of a file. In record mode it writes the fixture; always it lists the live fall-backs. */
export function finish(): void {
  if (RECORD) {
    mkdirSync(dirname(FIXTURE_FILE), { recursive: true });
    const text = JSON.stringify(fixture);
    writeFileSync(FIXTURE_FILE, text);
    console.log(`[desktopWeb] recorded ${Object.keys(fixture.calls).length} calls, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`);
  } else if (misses.size) {
    console.log(`[desktopWeb] ${misses.size} call(s) not in the fixture went to the live project:\n  ${[...misses].join("\n  ")}`);
  }
}

/** Relative times become one fixed word. Runs in the page before the app starts. */
const NORMALISE = `(() => {
  const re = /\\b\\d+\\s?(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|[smhdw])\\s(ago|left)\\b/i;
  const reAll = new RegExp(re.source, 'gi');
  // Presence has no "ago" (lib/presence.ts: "Away · 10 min", "Away · 2h 5m"), so it gets its own fixed word.
  const away = /\\bAway · \\d+\\s?(?:min|h)(?: \\d+m)?/g;
  // Only write when it changes: writing the same text again would fire the observer again, for ever.
  const fix = (n) => {
    const v = n.nodeValue;
    if (!v || !(re.test(v) || /\\bAway · \\d/.test(v))) return;
    const next = v.replace(reAll, (_m, w) => '2h ' + w).replace(away, 'Away · 2h');
    if (next !== v) n.nodeValue = next;
  };
  const walk = (root) => {
    if (root.nodeType === 3) return fix(root);
    const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = it.nextNode(); n; n = it.nextNode()) fix(n);
  };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') fix(m.target);
      else m.addedNodes.forEach((n) => walk(n));
    }
  }).observe(document, { childList: true, subtree: true, characterData: true });
})();`;

/**
 * The page's Date starts at the moment of recording and then runs on in real time. (Playwright's page.clock
 * would also replace timers and animation frames, which leaves the app's animations half-way, so buttons never
 * count as "stable".)
 */
function SHIFT_DATE(recordedAt: number): void {
  const Real = Date;
  const shift = recordedAt - Real.now();
  class Shifted extends Real {
    constructor(...args: unknown[]) {
      // @ts-expect-error the spread has to follow Date's overloads
      super(...(args.length === 0 ? [Real.now() + shift] : args));
    }
    static override now(): number {
      return Real.now() + shift;
    }
  }
  (globalThis as { Date: DateConstructor }).Date = Shifted as unknown as DateConstructor;
}

export type Overrides = {
  /** Answer the profile reads as if the person has not finished these steps yet (for the setup screens). */
  profile?: { onboarded_at?: null; worker_onboarded_at?: null };
};

/** Call before the first `page.goto`. */
export async function stabilise(
  page: Page,
  theme: "light" | "dark",
  mode: "poster" | "worker",
  overrides: Overrides = {},
  opts: { liveTiles?: boolean } = {},
): Promise<void> {
  liveTiles = !!opts.liveTiles;
  // First, so that the storage script below sees the same clock the app will.
  if (!RECORD) await page.addInitScript(SHIFT_DATE, new Date(fixture.recordedAt).getTime());
  await page.addInitScript(
    ([m, t]) => {
      try {
        localStorage.setItem("taskdrop.mode", m!);
        localStorage.setItem("taskdrop.theme", t!);
        // "Not now" on the location sheet, just now: Explore does not open it over the map (it opens on a race
        // with the profile read, which would make the pictures differ from run to run).
        localStorage.setItem("taskdrop.locationAsk.dismissedAt.v1", String(Date.now()));
        // The cookie bar (PR 418) shows until a choice is stored and sits over the phone tab bar. Pre-set the
        // privacy-friendly one, "Essential only" (no crash reports), the same value the app writes (lib/consent.ts),
        // so no picture contains the bar and nothing in the page has to click it away.
        localStorage.setItem("taskdrop.consent.v1", JSON.stringify({ analytics: false, at: "2026-11-17T00:00:00.000Z", v: 1 }));
      } catch {
        /* a browser without storage: the app keeps its defaults */
      }
    },
    [mode, theme],
  );
  if (!RECORD) await page.addInitScript(NORMALISE);
  profilePatch = overrides.profile;
  await page.route(() => true, handle);
}

/** Fonts loaded, no request in flight, entrance motion over. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready).catch(() => undefined);
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}
