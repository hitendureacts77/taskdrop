import { test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { MEERA, RAVI, ASHA } from "./helpers";

/**
 * A monkey: taps and types at random through the real web app for a few minutes, as a seed account, and
 * writes down everything that goes wrong: a thrown error, a failed request, a server error, a blank screen.
 * It never taps words that end an account or send money out (see AVOID). Repeatable: the same SEED taps
 * the same sequence. Run: MONKEY_SECONDS=240 MONKEY_SEED=7 npx playwright test e2e/monkey.spec.ts
 */

const SECONDS = Number(process.env.MONKEY_SECONDS || 120);
const SEED = Number(process.env.MONKEY_SEED || 1);
const WHO = (process.env.MONKEY_WHO || "meera").toLowerCase();
const account = WHO === "ravi" ? RAVI : WHO === "asha" ? ASHA : MEERA;

/** Words on buttons the monkey must not press: they end an account, or move money out for real. */
const AVOID = /delete|sign out|log ?out|remove account|withdraw now|confirm withdrawal|razorpay|pay now|pay ₹|release|dispute|ban|erase|deactivate/i;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

const FUZZ = ["", " ", "a", "test", "9990000001", "<script>alert(1)</script>", "'; drop table x; --", "😀😀😀", "x".repeat(400), "-1", "0", "1e99", "NaN", "null", "\u0000", "Ünïcödé ñ", "https://example.com", "me@example.com", "५००", "\\", "%00%0a"];

type Issue = { kind: string; where: string; detail: string };

test(`monkey: random taps as ${account.label}, ${SECONDS}s, seed ${SEED}`, async ({ browser }) => {
  test.skip(!process.env.MONKEY_SECONDS, "set MONKEY_SECONDS to run the monkey");
  test.setTimeout((SECONDS + 120) * 1000);
  const rand = rng(SEED);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const context = await browser.newContext({ storageState: account.state, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page: Page = await context.newPage();
  const issues: Issue[] = [];
  const seen = new Set<string>();
  let lastAction = "(start)";
  const note = (kind: string, detail: string) => {
    const key = `${kind}|${detail.slice(0, 160)}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ kind, where: lastAction, detail: detail.slice(0, 400) });
  };

  page.on("pageerror", (e) => note("page error", e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !/favicon|Download the React DevTools|sentry/i.test(m.text())) note("console error", m.text());
  });
  page.on("requestfailed", (r) => {
    if (!/sentry|imagekit|google|razorpay|gstatic|openstreetmap|tile/i.test(r.url())) note("request failed", `${r.method()} ${r.url().slice(0, 100)} ${r.failure()?.errorText}`);
  });
  page.on("response", async (r) => {
    const u = r.url();
    if (!/supabase\.co\/(functions|rest|auth)/.test(u)) return;
    if (r.status() >= 500) note("server error", `${r.status()} ${r.request().method()} ${u.replace(/^.*supabase\.co/, "")} ${(await r.text().catch(() => "")).slice(0, 120)}`);
    else if (r.status() >= 400 && r.status() !== 401 && r.status() !== 429 && !/phone-auth|password-auth/.test(u)) {
      const body = await r.text().catch(() => "");
      note("client error", `${r.status()} ${r.request().method()} ${u.replace(/^.*supabase\.co/, "")} ${body.slice(0, 120)}`);
    }
  });

  await page.goto("/");
  await page.waitForTimeout(2500);
  const end = Date.now() + SECONDS * 1000;
  let steps = 0;
  const blank = async () => {
    const text = (await page.locator("body").innerText().catch(() => "")).trim();
    return text.length < 8;
  };

  while (Date.now() < end) {
    steps++;
    if (steps % 25 === 0) {
      lastAction = "reload";
      await page.goto("/").catch(() => {});
      await page.waitForTimeout(1500);
    }
    // Anything clickable: a pointer cursor, or a button/link/tab role.
    const targets = await page.evaluate(() => {
      const out: { x: number; y: number; text: string }[] = [];
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("*"))) {
        const cs = getComputedStyle(el);
        const role = el.getAttribute("role");
        if (cs.cursor !== "pointer" && role !== "button" && role !== "tab" && role !== "link" && el.tagName !== "A" && el.tagName !== "BUTTON") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
        out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, text: (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 60) });
      }
      return out;
    }).catch(() => []);
    const inputs = await page.locator("input:visible, textarea:visible").count().catch(() => 0);

    if (inputs > 0 && rand() < 0.55) {
      const i = Math.floor(rand() * inputs);
      const value = pick(FUZZ);
      lastAction = `type ${JSON.stringify(value.slice(0, 20))} into input ${i}`;
      await page.locator("input:visible, textarea:visible").nth(i).fill(value, { timeout: 1500 }).catch(() => {});
    } else if (targets.length) {
      const safe = targets.filter((t) => !AVOID.test(t.text));
      const t = pick(safe.length ? safe : targets);
      if (AVOID.test(t.text)) continue;
      lastAction = `tap "${t.text}"`;
      await page.mouse.click(t.x, t.y).catch(() => {});
    } else {
      lastAction = "press Escape / back";
      await page.keyboard.press("Escape").catch(() => {});
    }
    await page.waitForTimeout(350 + Math.floor(rand() * 400));
    if (await blank()) {
      await page.waitForTimeout(2500); // a screen may just be loading
      if (!(await blank())) continue;
      note("blank screen", "nothing readable on the page");
      await page.screenshot({ path: `e2e/.out/blank-${steps}.png` }).catch(() => {});
      await page.goto("/").catch(() => {});
      await page.waitForTimeout(1500);
    }
    // An "Oops / something went wrong" screen is a failure even when nothing was thrown.
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 4000);
    const BAD = /([Ss]omething went wrong|[Cc]ouldn.t load|[Uu]nexpected error)|(\bundefined\b|\[object Object\]|\bNaN\b|Cannot read[^\n]*|₹\s?-)/;
    if (BAD.test(body)) {
      const m = body.match(BAD);
      note("bad text on screen", m?.[0] ?? "");
      await page.screenshot({ path: `e2e/.out/bad-text-${steps}.png` }).catch(() => {});
    }
  }

  mkdirSync("e2e/.out", { recursive: true });
  writeFileSync(`e2e/.out/monkey-${WHO}-${SEED}.json`, JSON.stringify({ steps, issues }, null, 2));
  console.log(`\nMONKEY (${account.label}, seed ${SEED}): ${steps} actions, ${issues.length} distinct problems`);
  for (const i of issues) console.log(`  [${i.kind}] after ${i.where}\n      ${i.detail}`);
  await context.close();
});
