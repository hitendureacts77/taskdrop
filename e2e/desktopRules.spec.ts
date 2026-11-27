import { expect, test, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MEERA } from "./helpers";
import { finish, settle, stabilise, type Overrides } from "./desktopWebKit";

/**
 * Desktop web package 16 (docs/design/desktop-web/PLAN.md, 4.3 and 6): the "rules every desktop page follows",
 * checked with DOM measurements (never screenshots) at 1440 x 900, on every screen the pictures guard
 * (desktopWeb.spec.ts) reaches, plus a few that are one click from the side menu.
 *
 *   rule 1  the page header owns the title, the tools and Back:
 *           (a) no phone-style title row in the page under the header,
 *           (b) exactly one avatar menu (one set of header tools),
 *           (c) no in-page back arrow that repeats the header's Back.
 *   rule 2  no button wider than 560 px outside a dialog or sheet.
 *   rule 4  the page is not one narrow column with empty sides, unless something fills the width: a page column and
 *           content of at least 960 px, or an aside. Maps and other full-bleed screens are exempt (a full map has no
 *           page header on purpose, so it has no avatar menu either: 0 or 1 there, exactly 1 elsewhere).
 *   Self-check: the last test adds a phone-style title, a second avatar menu, a back arrow, a wide button and a
 *   narrow column to the Wallet in the page and fails if any rule does not notice, so a passing run means something.
 *   (rule 3, "content sits on cards", and rule 5, "under 1024 nothing changes", are not measurable this way:
 *    rule 5 is the pixel guard in desktopWeb.spec.ts.)
 *
 * Same kit as desktopWeb.spec.ts: the app is answered from e2e/fixtures/desktop-web-api.json (desktopWebKit.ts),
 * so a run needs no fresh data. Each screen is loaded once; its measurements are shared by the rule tests.
 *
 * A real screen that breaks a rule is NOT relaxed here: list it in KNOWN with the reason, which turns that one
 * test into `test.fixme` (shown as skipped, with the reason), and report it in the PR as a finding.
 *
 * Run (from the repo root, after `npm run web:export` in apps/mobile):
 *   E2E_PORT=8124 npx playwright test --project=web-desktop-1440 desktopRules
 * Skipped, never failed, when there is no build or no saved sign-in (e2e/.auth), and in CI unless DESKTOP_GUARD=1.
 */

type Mode = "poster" | "worker";
type Rule = "rule1-title" | "rule1-tools" | "rule1-back" | "rule2-buttons" | "rule4-width";
const RULES: Rule[] = ["rule1-title", "rule1-tools", "rule1-back", "rule2-buttons", "rule4-width"];

type Screen = {
  id: string;
  mode: Mode;
  /** A full-window screen (the map): rule 4 does not apply, and the page header may not be there. */
  fullBleed?: boolean;
  overrides?: Overrides;
  open: (page: Page) => Promise<void>;
};

const name = (label: string) => new RegExp(`^${label}`);

async function tab(page: Page, label: string) {
  await page.getByRole("link", { name: name(label) }).or(page.getByRole("tab", { name: name(label) })).first().click();
}
async function headerButton(page: Page, label: string) {
  await page.getByRole("button", { name: name(label) }).first().click();
}
async function openFeedList(page: Page) {
  await tab(page, "(Explore|Find work)");
  const list = page.getByRole("button", { name: "Show the list" });
  if (await list.isVisible({ timeout: 4000 }).catch(() => false)) await list.click();
}

const SCREENS: Screen[] = [
  { id: "home-hire", mode: "poster", open: async () => {} },
  { id: "home-earn", mode: "worker", open: async () => {} },
  { id: "explore-list-hire", mode: "poster", open: (p) => openFeedList(p) },
  { id: "explore-list-earn", mode: "worker", open: (p) => openFeedList(p) },
  // The map itself (Explore opens on it): full-bleed, with its own floating tools.
  { id: "explore-map-earn", mode: "worker", fullBleed: true, open: (p) => tab(p, "(Explore|Find work)") },
  { id: "myTasks-hire", mode: "poster", open: (p) => tab(p, "My (Tasks|Work)") },
  { id: "myTasks-earn", mode: "worker", open: (p) => tab(p, "My (Tasks|Work)") },
  {
    // First job of the Earn feed (as in desktopWeb.spec.ts): the title opens the task, Apply would open the offer sheet.
    id: "taskDetail-earn",
    mode: "worker",
    open: async (page) => {
      await openFeedList(page);
      await page.getByRole("button", { name: /^Apply for / }).first().waitFor();
      const title = await page.getByRole("button", { name: /^Apply for / }).first().getAttribute("aria-label");
      await page.getByText(title!.replace(/^Apply for /, ""), { exact: true }).filter({ visible: true }).first().click();
      await page.getByText(/^budget$/i).filter({ visible: true }).first().waitFor();
    },
  },
  {
    // A new account's first switch to Earn: the profile read is answered as "not finished" (nothing is saved).
    id: "workerSetup-earn",
    mode: "worker",
    overrides: { profile: { worker_onboarded_at: null } },
    open: async (page) => {
      await page.getByRole("tab", { name: "Earn mode" }).click();
      await page.getByText("Start earning", { exact: true }).filter({ visible: true }).first().waitFor();
    },
  },
  { id: "wallet-hire", mode: "poster", open: (p) => tab(p, "Wallet") },
  { id: "profile-hire", mode: "poster", open: (p) => tab(p, "Profile") },
  { id: "account-hire", mode: "poster", open: (p) => tab(p, "Settings") },
  { id: "help-hire", mode: "poster", open: (p) => tab(p, "Help") },
  { id: "inbox-hire", mode: "poster", open: (p) => headerButton(p, "Messages") },
  { id: "notifications-hire", mode: "poster", open: (p) => headerButton(p, "Notifications") },
  { id: "aiPost-hire", mode: "poster", open: (p) => p.getByRole("button", { name: /^Say what you need/ }).click() },
  // "Offer a service" in the side menu (Earn): the listing form.
  { id: "listing-earn", mode: "worker", open: (p) => p.getByRole("button", { name: /^Offer a service/ }).or(p.getByRole("link", { name: /^Offer a service/ })).first().click() },
  // setup (onboarding) is left out for the same reason as in desktopWeb.spec.ts: the seed accounts have finished it.
];

/**
 * Real violations found by this check, left failing on purpose (never relaxed): `${screen id}:${rule}` -> reason.
 * Each is reported in the PR that added this file.
 */
const KNOWN: Record<string, string> = {
  // "aiPost-hire:rule4-width" (found 19 Nov 2026) was fixed by package 13: the AI writer is a FormPage card with a
  // live post preview in the aside.
};

test.use({ storageState: MEERA.state, colorScheme: "light", reducedMotion: "reduce", locale: "en-IN", timezoneId: "Asia/Kolkata" });
test.afterAll(() => finish());
test.skip(
  () => !existsSync(resolve("apps/mobile/dist/index.html")) || !existsSync(resolve(MEERA.state)) || (!!process.env.CI && process.env.DESKTOP_GUARD !== "1"),
  "needs apps/mobile/dist (npm run web:export) and e2e/.auth (the setup project); not run in CI unless DESKTOP_GUARD=1",
);

/** What the page measured about itself. Everything is in CSS pixels of the 1440-wide window. */
type Measured = {
  title: string | null;
  headerBottom: number | null;
  /** Width of the column the page header sits on (the screen's column class: FORM, READ, FEED). */
  columnWidth: number | null;
  mainLeft: number;
  accountMenus: number;
  titleRows: string[];
  backControls: { label: string; iconOnly: boolean }[];
  headerBack: boolean;
  wideButtons: { label: string; w: number; h: number }[];
  content: { left: number; right: number; width: number } | null;
  aside: boolean;
  fullBleed: boolean;
};

/** Runs in the page. No imports, no outer variables: it is serialised. */
function measureInPage(): Measured {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const shown = (el: Element) =>
    (el as HTMLElement).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) !== false &&
    el.getBoundingClientRect().width > 0 &&
    el.getBoundingClientRect().height > 0;
  const all = Array.from(document.body.querySelectorAll("*")).filter(shown);
  const label = (el: Element) => (el.getAttribute("aria-label") || (el.textContent ?? "")).replace(/\s+/g, " ").trim();
  const ownText = (el: Element) =>
    Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue ?? "").join("").replace(/\s+/g, " ").trim();
  const inDialog = (el: Element) => !!el.closest('[role="dialog"],[role="alertdialog"],[aria-modal="true"],dialog');

  // The header row: the first ancestor of the avatar menu that is a real row (the header has minHeight 76).
  // The desktop page zoom (lib/desktopScale.web.ts) draws those 76 design px as fewer window px (about 70 at 1440,
  // a hair under 70 on the tab screens), so the row is also known by its own min-height, which the zoom does not
  // change. Without it the walk climbed to the whole column (headerBottom = the window, no content under it).
  const menus = all.filter((el) => el.getAttribute("aria-label") === "Account menu");
  let headerRow: Element | null = null;
  for (let el: Element | null = menus[0] ?? null; el && el !== document.body; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.width >= 500 && (r.height >= 70 || parseFloat(getComputedStyle(el).minHeight) >= 70)) {
      headerRow = el;
      break;
    }
  }
  const headerRect = headerRow?.getBoundingClientRect() ?? null;
  const headerBottom = headerRect ? headerRect.bottom : null;
  const inHeader = (el: Element) => !!headerRow && headerRow.contains(el);

  // The side menu: the tall column that holds the "Home" link.
  let nav: Element | null = null;
  const homeLink = all.find((el) => el.getAttribute("role") === "link" && /^Home/.test(label(el)));
  for (let el: Element | null = homeLink ?? null; el && el !== document.body; el = el.parentElement) {
    const r = el.getBoundingClientRect();
    if (r.height >= vh * 0.8 && r.width < 400) {
      nav = el;
      break;
    }
  }
  const mainLeft = nav ? nav.getBoundingClientRect().right : 0;
  const inNav = (el: Element) => !!nav && nav.contains(el);
  const below = (el: Element) => headerBottom === null || el.getBoundingClientRect().top >= headerBottom - 2;

  const heading = headerRow
    ? Array.from(headerRow.querySelectorAll('[role="heading"],h1,h2,h3')).find(shown)
    : undefined;
  const title = heading ? label(heading) : null;

  // Rule 1a. A title row is a heading-sized, heading-weight piece of text that says the page's own title, sits just
  // under the header and is not inside a card (a card's own section heading may reuse the word: "Wallet" on the
  // wallet card is not a phone header). Tolerant on purpose: only the first 220 px under the header are looked at.
  const bordered = (el: Element) => {
    for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (parseFloat(cs.borderTopWidth) >= 1 && parseFloat(cs.borderTopLeftRadius) >= 8) return true;
    }
    return false;
  };
  const titleRows: string[] = [];
  if (title && headerBottom !== null) {
    for (const el of all) {
      if (inHeader(el) || inNav(el) || inDialog(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.top < headerBottom - 2 || r.top > headerBottom + 220) continue;
      if (ownText(el).toLowerCase() !== title.toLowerCase()) continue;
      const cs = getComputedStyle(el);
      if (parseFloat(cs.fontSize) < 18 || parseInt(cs.fontWeight, 10) < 700) continue;
      if (bordered(el)) continue;
      titleRows.push(`${ownText(el)} @y${Math.round(r.top)} ${cs.fontSize}/${cs.fontWeight}`);
    }
  }

  // Rule 1c. Back controls under the header: named exactly "Back" (an icon-only one has no text of its own).
  const controls = all.filter((el) => /^(button|link)$/.test(el.getAttribute("role") ?? "") || el.tagName === "BUTTON" || el.tagName === "A");
  const headerBack = controls.some((el) => inHeader(el) && label(el) === "Back");
  const backControls = controls
    .filter((el) => !inHeader(el) && !inNav(el) && !inDialog(el) && below(el))
    .filter((el) => el.getAttribute("aria-label") === "Back" || (el.textContent ?? "").trim() === "Back")
    .map((el) => ({ label: label(el), iconOnly: (el.textContent ?? "").trim() === "" }));

  // Rule 2. A "button" here is a short, one-or-two-line control that is filled or outlined; wide tappable cards
  // and list rows (several lines, no fill of their own) are rows, not buttons.
  const isFilled = (el: Element) => {
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const solid = bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    return solid || parseFloat(cs.borderTopWidth) >= 1;
  };
  const wideButtons = controls
    .filter((el) => el.getAttribute("role") === "button" || el.tagName === "BUTTON")
    .filter((el) => !inDialog(el) && !inNav(el))
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ el, r }) => r.width > 560 && r.height <= 64 && (el.textContent ?? "").trim().length > 0 && (el.textContent ?? "").trim().length <= 40 && isFilled(el))
    .map(({ el, r }) => ({ label: label(el).slice(0, 60), w: Math.round(r.width), h: Math.round(r.height) }));

  // Rule 4. The box around everything the page draws under the header and beside the menu: text, pictures, fields
  // and bordered cards. Fixed things (cookie bar, toasts, the + button) are not the page.
  // A full map fills most of the window both ways; the short live-map strip over the Explore list does not count.
  const mapShown = all.some((el) => {
    if (!el.classList.contains("maplibregl-map")) return false;
    const r = el.getBoundingClientRect();
    return r.width > (vw - mainLeft) * 0.6 && r.height > vh * 0.6;
  });
  let left = Infinity;
  let right = -Infinity;
  for (const el of all) {
    if (inHeader(el) || inNav(el) || inDialog(el)) continue;
    const r = el.getBoundingClientRect();
    if (headerBottom !== null && r.top < headerBottom - 2) continue;
    if (r.left < mainLeft - 1 || r.right > vw + 1 || r.width < 8) continue;
    if (!(r.top < vh)) continue;
    let fixed = false;
    for (let a: Element | null = el; a && a !== document.body; a = a.parentElement) {
      if (getComputedStyle(a).position === "fixed") fixed = true;
    }
    if (fixed) continue;
    const tag = el.tagName;
    const content =
      ownText(el) !== "" ||
      tag === "IMG" ||
      tag === "SVG" ||
      tag === "CANVAS" ||
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      (bordered(el) && r.width >= 200 && r.height >= 40) ||
      // A pane that is only marked by a hairline on one side (the Messages chat pane) is still page content.
      (r.width >= 200 && r.height >= 150 && (parseFloat(getComputedStyle(el).borderLeftWidth) >= 1 || parseFloat(getComputedStyle(el).borderRightWidth) >= 1));
    if (!content) continue;
    left = Math.min(left, r.left);
    right = Math.max(right, r.right);
  }
  const content = right > left ? { left: Math.round(left), right: Math.round(right), width: Math.round(right - left) } : null;
  // An aside: a sticky box 240 to 480 wide that is tall enough to be a column (FormPage's preview or steps).
  const aside = all.some((el) => {
    const r = el.getBoundingClientRect();
    return getComputedStyle(el).position === "sticky" && r.width >= 240 && r.width <= 480 && r.height >= 150 && r.left > mainLeft + (vw - mainLeft) / 2 - 100;
  });

  return {
    title,
    headerBottom: headerBottom === null ? null : Math.round(headerBottom),
    columnWidth: headerRect ? Math.round(headerRect.width) : null,
    mainLeft: Math.round(mainLeft),
    accountMenus: menus.length,
    titleRows,
    backControls,
    headerBack,
    wideButtons,
    content,
    aside,
    fullBleed: mapShown,
  };
}

/** Each rule's verdict for one measurement: an empty list is a pass. */
function verdicts(screen: Screen, m: Measured, vw: number): Record<Rule, string[]> {
  const out: Record<Rule, string[]> = { "rule1-title": [], "rule1-tools": [], "rule1-back": [], "rule2-buttons": [], "rule4-width": [] };
  // Rule 1a: the header has a title and the page repeats it under the header.
  out["rule1-title"] = m.titleRows.map((r) => `title "${m.title}" repeated in the page: ${r}`);
  // Rule 1b: one avatar menu (the page header's), not zero and not two.
  // A full map has no page header on purpose (the side menu carries Messages, Notifications and Profile): 0 or 1 there.
  const tooMany = m.accountMenus > 1;
  if (tooMany || (m.accountMenus === 0 && !screen.fullBleed && !m.fullBleed)) out["rule1-tools"].push(`${m.accountMenus} avatar menu(s) shown, expected exactly 1`);
  // Rule 1c: an icon-only Back in the page is a phone header row; any Back that repeats the header's Back is a duplicate.
  for (const b of m.backControls) {
    if (b.iconOnly) out["rule1-back"].push(`in-page back arrow (icon only, label "${b.label}")`);
    else if (m.headerBack) out["rule1-back"].push(`in-page "${b.label}" repeats the header's Back`);
  }
  out["rule2-buttons"] = m.wideButtons.map((b) => `"${b.label}" is ${b.w} px wide (${b.h} px tall)`);
  if (!screen.fullBleed && !m.fullBleed) {
    const c = m.content;
    if (!c) out["rule4-width"].push("no content measured");
    else {
      const gapLeft = c.left - m.mainLeft;
      const gapRight = vw - c.right;
      // Two ways to be a narrow single column, both with no aside and under 960 px:
      //  - the page's own column (the one its header sits on) is narrower than 960: a FORM column of 760 design px;
      //  - what is drawn in it is narrower than 960 and has more than 160 px empty on BOTH sides. (Needing both sides
      //    keeps a wide column with a short list at its left, or a centred empty state, from counting.)
      if (!m.aside) {
        if (m.columnWidth !== null && m.columnWidth < 960) out["rule4-width"].push(`the page column is ${m.columnWidth} px wide, under 960, and nothing fills the side (no aside)`);
        else if (c.width < 960 && gapLeft > 160 && gapRight > 160) {
          out["rule4-width"].push(`one column ${c.width} px wide (x ${c.left} to ${c.right}), ${gapLeft} px empty left and ${gapRight} px right, no aside`);
        }
      }
    }
  }
  return out;
}

const cache = new Map<string, Measured>();

/** Signed-in app on the screen, settled. */
async function load(page: Page, screen: Screen): Promise<void> {
  await stabilise(page, "light", screen.mode, screen.overrides, { liveTiles: false });
  await page.goto("/");
  await page.getByRole("link", { name: "Home" }).or(page.getByRole("tab", { name: "Home" })).first().waitFor({ timeout: 30_000 });
  const staging = page.getByRole("button", { name: "Got it", exact: true });
  if (await staging.isVisible({ timeout: 3000 }).catch(() => false)) await staging.click();
  await screen.open(page);
  await settle(page);
}

async function measure(page: Page, screen: Screen): Promise<Measured> {
  const hit = cache.get(screen.id);
  if (hit) return hit;
  await load(page, screen);
  const m = await page.evaluate(measureInPage);
  // DESKTOP_RULES_SHOTS=<folder> keeps a picture of each screen as measured (for the PR; never compared).
  if (process.env.DESKTOP_RULES_SHOTS) await page.screenshot({ path: resolve(process.env.DESKTOP_RULES_SHOTS, `${screen.id}.png`), animations: "disabled", caret: "hide" });
  cache.set(screen.id, m);
  // DESKTOP_RULES_DUMP=1 prints what every screen measured (to see why a rule passed or failed).
  if (process.env.DESKTOP_RULES_DUMP === "1") console.log(`[desktopRules] ${screen.id} ${JSON.stringify(m)}`);
  return m;
}

for (const screen of SCREENS) {
  for (const rule of RULES) {
    test(`desktop rules 1440: ${screen.id} ${rule}`, async ({ page }, info) => {
      test.skip(info.project.name !== "web-desktop-1440", "measured by web-desktop-1440 only");
      test.fixme(!!KNOWN[`${screen.id}:${rule}`], KNOWN[`${screen.id}:${rule}`] ?? "");
      const m = await measure(page, screen);
      const found = verdicts(screen, m, 1440)[rule];
      expect(found, `${screen.id} breaks ${rule} (measured ${JSON.stringify(m)})`).toEqual([]);
    });
  }
}

/**
 * The checks must be able to fail. On the real Wallet screen (which passes every rule above) this adds, in the page
 * itself, one thing that breaks each rule: a phone-style title row, a second avatar menu, an icon-only back arrow, a
 * 700 px wide filled button, and a column narrowed to 700 px. Every rule must then report it. Nothing is saved or sent.
 */
test("desktop rules 1440: the checks catch a phone-style page", async ({ page }, info) => {
  test.skip(info.project.name !== "web-desktop-1440", "measured by web-desktop-1440 only");
  const screen = SCREENS.find((s) => s.id === "wallet-hire")!;
  await load(page, screen);
  const before = verdicts(screen, await page.evaluate(measureInPage), 1440);
  for (const rule of RULES) expect(before[rule], `the untouched wallet breaks ${rule}`).toEqual([]);
  await page.evaluate(() => {
    const menu = Array.from(document.querySelectorAll('[aria-label="Account menu"]')).find((e) => e.getBoundingClientRect().width > 0)!;
    let row: Element = menu;
    // The same walk as measureInPage: the row is also known by its min-height under the desktop page zoom.
    const isRow = (e: Element) =>
      e.getBoundingClientRect().width >= 500 && (e.getBoundingClientRect().height >= 70 || parseFloat(getComputedStyle(e).minHeight) >= 70);
    while (row.parentElement && !isRow(row)) row = row.parentElement;
    const heading = Array.from(row.querySelectorAll('[role="heading"],h1,h2,h3')).find((e) => e.getBoundingClientRect().width > 0)!;
    const bottom = row.getBoundingClientRect().bottom;
    const left = row.getBoundingClientRect().left + 20;
    // A narrower column, as a FORM column would be (the header row is as wide as the column it sits on).
    (row.parentElement as HTMLElement).style.maxWidth = "700px";
    const add = (html: string, css: string) => {
      const d = document.createElement("div");
      d.innerHTML = html;
      d.style.cssText = `position:absolute;left:${left}px;${css}`;
      document.body.appendChild(d);
      return d;
    };
    add((heading.textContent ?? "").trim(), `top:${bottom + 20}px;font-size:26px;font-weight:800`);
    add("x", `top:${bottom + 90}px;width:40px;height:40px`).setAttribute("aria-label", "Account menu");
    const back = add("", `top:${bottom + 150}px;width:40px;height:40px`);
    back.setAttribute("role", "button");
    back.setAttribute("aria-label", "Back");
    const wide = add("Continue", `top:${bottom + 210}px;width:700px;height:52px;background:#0a6f58;color:#fff`);
    wide.setAttribute("role", "button");
  });
  const after = verdicts(screen, await page.evaluate(measureInPage), 1440);
  for (const rule of RULES) expect(after[rule].length, `${rule} did not notice what was added (found: ${JSON.stringify(after[rule])})`).toBeGreaterThan(0);
});
