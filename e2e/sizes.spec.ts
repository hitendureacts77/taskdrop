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
  return { sideways, outside };
}

for (const screen of SCREENS) {
  for (const size of SIZES) {
    test(`${screen.id} at ${size.w} wide: no sideways scroll, nothing outside the window`, async ({ page }) => {
      await page.setViewportSize({ width: size.w, height: size.h });
      await stabilise(page, "light", screen.mode, {}, { liveTiles: false });
      await page.goto("/");
      await page.getByRole("link", { name: "Home" }).or(page.getByRole("tab", { name: "Home" })).first().waitFor({ timeout: 30_000 });
      const staging = page.getByRole("button", { name: "Got it", exact: true });
      if (await staging.isVisible({ timeout: 3000 }).catch(() => false)) await staging.click();
      await screen.open(page);
      await settle(page);
      const m = await page.evaluate(measureOverflow);
      expect(m.sideways, "the page scrolls sideways by this many px").toBeLessThanOrEqual(1);
      expect(m.outside, "buttons outside the window").toEqual([]);
    });
  }
}
