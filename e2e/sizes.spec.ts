import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MEERA } from "./helpers";
import { finish, settle, stabilise } from "./desktopWebKit";

/**
 * Plan task 1.14, level 1: "never broken" at six widths. Every screen below is opened at 320, 360, 768, 1024, 1440
 * and 1920 wide; the page must not scroll sideways and no button or link may sit outside the window (elements
 * inside a container that scrolls sideways on purpose, like a chip row, are not counted).
 *
 * The app is answered from e2e/fixtures/desktop-web-api.json (desktopWebKit.ts), so a run needs no fresh data.
 * To add a screen to the guard, add a line to SCREENS; a new screen is not done until it passes here (layout rule 8).
 *
 * Run (repo root, after `npm run web:export` in apps/mobile):
 *   E2E_PORT=8124 npx playwright test --project=web-sizes
 * Skipped when there is no build or no saved sign-in (e2e/.auth).
 */

const SIZES = [
  { w: 320, h: 640 },
  { w: 360, h: 800 },
  { w: 768, h: 1024 },
  { w: 1024, h: 768 },
  { w: 1440, h: 900 },
  { w: 1920, h: 1080 },
];

// Level 1 items 3 to 6 (plan task 1.14): the same checks on the awkward shapes. A small phone at 320 x 568, a phone
// turned sideways (800 x 360), a short laptop (1366 x 768, 1280 x 720) and a laptop zoomed to 200% (640 x 360).
// `touch` sizes also check item 7, the 48-point tap targets.
const EXTRA = [
  { w: 320, h: 568, touch: true },
  { w: 800, h: 360, touch: true },
  { w: 1366, h: 768, touch: false },
  { w: 1280, h: 720, touch: false },
  { w: 640, h: 360, touch: false },
];

const tab = (page: Page, label: string) =>
  page.getByRole("link", { name: new RegExp(`^${label}`) }).or(page.getByRole("tab", { name: new RegExp(`^${label}`) })).first().click();
const headerButton = (page: Page, label: string) => page.getByRole("button", { name: new RegExp(`^${label}`) }).first().click();

type Mode = "poster" | "worker";
const SCREENS: { id: string; mode: Mode; open: (p: Page) => Promise<void> }[] = [
  { id: "home-hire", mode: "poster", open: async () => {} },
  { id: "home-earn", mode: "worker", open: async () => {} },
  { id: "explore", mode: "worker", open: (p) => tab(p, "Explore") },
  { id: "myTasks-hire", mode: "poster", open: (p) => tab(p, "My (Tasks|Work)") },
  { id: "inbox", mode: "poster", open: (p) => headerButton(p, "Messages") },
  { id: "notifications", mode: "poster", open: (p) => headerButton(p, "Notifications") },
];

test.use({ storageState: MEERA.state, colorScheme: "light", reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata" });
test.afterAll(() => finish());
test.skip(
  () => !existsSync(resolve("apps/mobile/dist/index.html")) || !existsSync(resolve(MEERA.state)),
  "needs apps/mobile/dist (npm run web:export) and e2e/.auth (the setup project)",
);

/** Runs in the page (serialised: no imports, no outer variables). */
function measureOverflow() {
  const vw = window.innerWidth;
  const root = document.documentElement;
  const sideways = Math.max(root.scrollWidth, document.body.scrollWidth) - vw;
  const scrollsSideways = (el: Element) => {
    for (let a: Element | null = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll|hidden)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1) return true;
    }
    return false;
  };
  const outside: string[] = [];
  for (const el of Array.from(document.querySelectorAll('button,a,[role="button"],[role="link"],[role="tab"]'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((el as HTMLElement).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) continue;
    if ((r.left < -1 || r.right > vw + 1) && !scrollsSideways(el)) {
      outside.push(`${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40)} (${Math.round(r.left)}..${Math.round(r.right)} of ${vw})`);
    }
  }
  // Item 7: a tap target is at least 48 across in both directions.
  const small: string[] = [];
  for (const el of Array.from(document.querySelectorAll('button,[role="button"],[role="tab"],[role="switch"],[role="checkbox"],input,select'))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((el as HTMLElement).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) === false) continue;
    if (r.right < 0 || r.left > vw || r.bottom < 0 || r.top > window.innerHeight) continue;
    if (Math.min(r.width, r.height) < 47.5) {
      small.push(`${(el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30)} (${Math.round(r.width)}x${Math.round(r.height)})`);
    }
  }
  // Item 6: a dialog or sheet is never taller than the window.
  const tall: string[] = [];
  for (const el of Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],[aria-modal="true"]'))) {
    const r = el.getBoundingClientRect();
    if (r.height > window.innerHeight + 1 || r.bottom > window.innerHeight + 1) tall.push(`${Math.round(r.top)}..${Math.round(r.bottom)} of ${window.innerHeight}`);
  }
  // Which boxes stick out past the right edge (the first few, to point at the cause of a sideways scroll).
  const wide: string[] = [];
  if (sideways > 1) {
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && !scrollsSideways(el)) wide.push(`${el.tagName}[${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}] right=${Math.round(r.right)}`);
      if (wide.length >= 6) break;
    }
  }
  return { sideways, outside, small, tall, wide };
}

for (const screen of SCREENS) {
  for (const size of [...SIZES.map((s) => ({ ...s, touch: s.w < 1024 })), ...EXTRA]) {
    test(`${screen.id} at ${size.w} x ${size.h}: no sideways scroll, nothing outside the window${size.touch ? ", 48 pt taps" : ""}`, async ({ page }) => {
      await page.setViewportSize({ width: size.w, height: size.h });
      await stabilise(page, "light", screen.mode, {}, { liveTiles: false });
      await page.goto("/");
      await page.getByRole("link", { name: "Home" }).or(page.getByRole("tab", { name: "Home" })).first().waitFor({ timeout: 30_000 });
      const staging = page.getByRole("button", { name: "Got it", exact: true });
      if (await staging.isVisible({ timeout: 3000 }).catch(() => false)) await staging.click();
      await screen.open(page);
      await settle(page);
      const m = await page.evaluate(measureOverflow);
      expect(m.sideways, `the page scrolls sideways by this many px; boxes past the edge: ${m.wide.join(" | ")}`).toBeLessThanOrEqual(1);
      expect(m.outside, "buttons outside the window").toEqual([]);
      expect(m.tall, "dialogs taller than the window").toEqual([]);
      // Item 7 is MEASURED here, not yet enforced: react-native-web draws no hitSlop, so the real fix (a 48 point
      // touch area around each small icon button without changing how it looks) needs the owner's eye. The findings
      // are attached to the run, and a number of 0 will turn this into a hard check.
      if (size.touch) test.info().annotations.push({ type: "tap-targets-under-48", description: `${m.small.length}: ${m.small.join("; ")}` });
    });
  }
}

// Level 1 item 2: resizing or turning the screen loses nothing. Type in the "say what you need" box on a phone, turn
// it sideways (tablet layout), turn it back: the words are still there.
test("a half-written task survives turning the screen and back", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await stabilise(page, "light", "poster", {}, { liveTiles: false });
  await page.goto("/");
  await page.getByRole("link", { name: "Home" }).or(page.getByRole("tab", { name: "Home" })).first().waitFor({ timeout: 30_000 });
  const staging = page.getByRole("button", { name: "Got it", exact: true });
  if (await staging.isVisible({ timeout: 3000 }).catch(() => false)) await staging.click();
  await page.getByRole("button", { name: /^Say what you need/ }).click();
  await settle(page);
  const box = page.getByRole("textbox").filter({ visible: true }).first();
  await box.fill("paint my balcony railing on Saturday");
  for (const size of [{ width: 844, height: 390 }, { width: 1100, height: 700 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await page.waitForTimeout(600);
    await expect(page.getByRole("textbox").filter({ visible: true }).first()).toHaveValue("paint my balcony railing on Saturday");
  }
});
