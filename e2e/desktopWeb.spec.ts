import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { MEERA } from "./helpers";
import { RECORD, finish, settle, stabilise, type Overrides } from "./desktopWebKit";

/**
 * Desktop web package 0 (docs/design/desktop-web/PLAN.md, sections 5 and 6): pictures of how the screens
 * look today, and a guard that the phone and tablet look never change.
 *
 *  - project `web-desktop-1440`: saves 1440 x 900 pictures into docs/design/desktop-web/before/
 *    (or the folder in DESKTOP_PICS_DIR, e.g. `after` while building a package). Nothing is compared.
 *  - project `web-phone-same`: 390 x 844 and 820 x 1180, each compared with the committed baseline with
 *    maxDiffPixels 0. A difference is a bug, never a new baseline.
 *
 * Why Meera and a fixture file: see e2e/desktopWebKit.ts. Re-record the fixture (DESKTOP_RECORD=1) only on
 * purpose, together with new baselines (--update-snapshots), never to make a failing run pass.
 *
 * Run the guard against a branch (from the repo root, after `npm run web:export` in apps/mobile):
 *   E2E_PORT=8104 npx playwright test --project=web-phone-same
 * Without sign-in, reusing the saved sessions in e2e/.auth:
 *   E2E_PORT=8104 npx playwright test --project=web-phone-same --no-deps
 * Use `--no-deps` only within about an hour of the last sign-in: with an older saved session the profile and
 * account screens show "phone not verified" (Level 0/3) and no location line, which is a false difference.
 * The cookie bar is pre-answered ("Essential only") by stabilise(), so no picture contains it.
 */

type Mode = "poster" | "worker";
type Ctx = { page: Page; wide: boolean };
type Screen = {
  id: string;
  /** Hire (poster) and/or Earn (worker). Always light unless `dark` lists the modes. */
  hire?: boolean;
  earn?: boolean;
  dark?: Mode[];
  overrides?: Overrides;
  /** Earn modes at phone and tablet sizes too (the desktop-only extras are left out). */
  phone?: { hire?: boolean; earn?: boolean };
  open: (c: Ctx) => Promise<void>;
};

const name = (label: string) => new RegExp(`^${label}`);

/** A tab of the bottom bar (phone) or an item of the side menu (desktop, tablet rail). */
async function tab(page: Page, label: string) {
  await page.getByRole("link", { name: name(label) }).or(page.getByRole("tab", { name: name(label) })).first().click();
}

/** The bell and the speech bubble in the top bar (everywhere), the side menu also lists them. */
async function headerButton(page: Page, label: string) {
  await page.getByRole("button", { name: name(label) }).first().click();
}

async function openFeedList(page: Page) {
  await tab(page, "Explore");
  const list = page.getByRole("button", { name: "Show the list" });
  if (await list.isVisible({ timeout: 4000 }).catch(() => false)) await list.click();
}

const SCREENS: Screen[] = [
  { id: "home", hire: true, earn: true, dark: ["poster", "worker"], phone: { hire: true, earn: true }, open: async () => {} },
  { id: "explore", hire: true, earn: true, dark: ["poster"], phone: { hire: true, earn: true }, open: ({ page }) => openFeedList(page) },
  { id: "myTasks", hire: true, earn: true, dark: ["poster"], phone: { hire: true, earn: true }, open: ({ page }) => tab(page, "My (Tasks|Work)") },
  {
    // First job of the Earn feed. Hire mode lists helpers, not jobs, so this one is Earn only.
    id: "taskDetail",
    earn: true,
    phone: { earn: true },
    open: async ({ page }) => {
      await openFeedList(page);
      await page.getByRole("button", { name: /^Apply for / }).first().waitFor();
      // The card's title opens the task; the Apply button would open the offer sheet.
      const title = await page.getByRole("button", { name: /^Apply for / }).first().getAttribute("aria-label");
      await page.getByText(title!.replace(/^Apply for /, ""), { exact: true }).filter({ visible: true }).first().click();
      // The detail page has opened when its budget line is shown (the explore list stays mounted but hidden).
      await page.getByText(/^budget$/i).filter({ visible: true }).first().waitFor();
    },
  },
  {
    // The first switch to Earn of a person with no worker profile. The seed accounts are all set up, so the
    // profile read is answered as "not finished" and the real switch is clicked (nothing is saved).
    id: "workerSetup",
    earn: true,
    overrides: { profile: { worker_onboarded_at: null } },
    phone: { earn: true },
    open: async () => {},
  },
  { id: "wallet", hire: true, dark: ["poster"], phone: { hire: true }, open: ({ page }) => tab(page, "Wallet") },
  { id: "profile", hire: true, dark: ["poster"], phone: { hire: true }, open: ({ page }) => tab(page, "Profile") },
  {
    id: "account",
    hire: true,
    phone: { hire: true },
    open: async ({ page, wide }) => {
      // The desktop menu and the tablet rail list Settings; the phone has it in the account menu.
      const item = page.getByRole("link", { name: /^Settings/ }).first();
      if (await item.isVisible().catch(() => false)) return item.click();
      await page.getByRole("button", { name: "Account menu" }).click();
      await page.getByText("Settings", { exact: true }).first().click();
    },
  },
  { id: "inbox", hire: true, phone: { hire: true }, open: ({ page }) => headerButton(page, "Messages") },
  { id: "notifications", hire: true, phone: { hire: true }, open: ({ page }) => headerButton(page, "Notifications") },
  { id: "aiPost", hire: true, phone: { hire: true }, open: ({ page }) => page.getByRole("button", { name: /^Say what you need/ }).click() },
  // setup (onboarding after sign-up): the seed accounts have finished it and the sign-in route is only taken
  // once, at first sign-in, so there is no way to open it on a settled session. Left out on purpose.
];

const isDesktop = (projectName: string) => projectName === "web-desktop-1440";
const PICS = resolve(process.env.DESKTOP_PICS_DIR || "docs/design/desktop-web/before");

test.use({ storageState: MEERA.state, colorScheme: "light", reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata" });
test.afterAll(() => finish());
// Nothing to compare or sign in with: skip, never fail (a plain `playwright test` on a machine without the
// export or the saved sign-in, or the CI job, which runs on Linux where the baselines would not match).
test.skip(
  () => !existsSync(resolve("apps/mobile/dist/index.html")) || !existsSync(resolve(MEERA.state)) || (!!process.env.CI && process.env.DESKTOP_GUARD !== "1"),
  "needs apps/mobile/dist (npm run web:export) and e2e/.auth (the setup project); not run in CI unless DESKTOP_GUARD=1",
);

type Plan = { screen: Screen; mode: Mode; theme: "light" | "dark" };

function plans(desktop: boolean): Plan[] {
  const out: Plan[] = [];
  for (const screen of SCREENS) {
    const modes: Mode[] = [];
    if (desktop ? screen.hire : screen.phone?.hire) modes.push("poster");
    if (desktop ? screen.earn : screen.phone?.earn) modes.push("worker");
    for (const mode of modes) {
      out.push({ screen, mode, theme: "light" });
      if (desktop && screen.dark?.includes(mode)) out.push({ screen, mode, theme: "dark" });
    }
  }
  return out;
}

async function run(page: Page, p: Plan, wide: boolean) {
  await stabilise(page, p.theme, p.mode, p.screen.overrides, { liveTiles: wide });
  await page.goto("/");
  // Signed in = the navigation is there (the tablet rail has no words, so not "Wallet" as in expectSignedIn).
  await page.getByRole("link", { name: "Home" }).or(page.getByRole("tab", { name: "Home" })).first().waitFor({ timeout: 30_000 });
  const staging = page.getByRole("button", { name: "Got it", exact: true });
  if (await staging.isVisible({ timeout: 3000 }).catch(() => false)) await staging.click();
  if (p.screen.id === "workerSetup") {
    await page.getByRole("tab", { name: "Earn mode" }).click();
    await page.getByText("Start earning", { exact: true }).filter({ visible: true }).first().waitFor();
  } else {
    await p.screen.open({ page, wide });
  }
  await settle(page);
}

/** Things that still move on their own, hidden from the picture. */
const live = (page: Page) => [
  // The map behind the Explore list: tiles load at their own pace.
  page.locator(".maplibregl-map"),
];

for (const p of plans(true)) {
  const tag = `${p.screen.id}-${p.mode === "poster" ? "hire" : "earn"}-${p.theme}`;
  test(`desktop 1440: ${tag}`, async ({ page }, info) => {
    test.skip(!isDesktop(info.project.name), "pictures are taken by web-desktop-1440");
    await run(page, p, true);
    mkdirSync(PICS, { recursive: true });
    await page.screenshot({ path: resolve(PICS, `1440-${tag}.png`), animations: "disabled", caret: "hide" });
  });
}

for (const size of [{ w: 390, h: 844 }, { w: 820, h: 1180 }]) {
  for (const p of plans(false)) {
    const tag = `${p.screen.id}-${p.mode === "poster" ? "hire" : "earn"}-${size.w}`;
    test(`phone/tablet ${size.w}: ${tag}`, async ({ page }, info) => {
      test.skip(isDesktop(info.project.name), "the guard is run by web-phone-same");
      await page.setViewportSize({ width: size.w, height: size.h });
      await run(page, p, size.w >= 1024);
      await expect(page).toHaveScreenshot(`${tag}.png`, { animations: "disabled", maxDiffPixels: 0, mask: live(page), caret: "hide" });
    });
  }
}

// Recording the fixture is a separate, deliberate run: DESKTOP_RECORD=1 ... --project=web-phone-same --project=web-desktop-1440
void RECORD;
