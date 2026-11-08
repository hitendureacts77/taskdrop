import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ASHA, RAVI, SUPABASE_URL, accessToken, apiAs, expectSignedIn } from "./helpers";

// "My people" end to end (docs/design/map-tab/PLAN.md: WP4b layer, WP6 consent sheet, privacy rule 35b).
// Two browser contexts on the cloud TEST project with the seed accounts: Ravi (worker) shares his spot, Asha
// (poster) sees him in her "My people" layer at a rounded cell, then Ravi hides and Asha no longer sees him.
// Seed Asha and Ravi share many COMPLETED tasks, so they are "my people" for each other.
// Desktop project only. Assertions stay on controls and text, never on map tiles.

// Madhapur, Hyderabad. The device snaps this to the 0.005-degree grid before it sends anything.
const RAVI_AT = { latitude: 17.4486, longitude: 78.3908 };
const GRID = 0.005;

test.setTimeout(300_000);

const isOnGrid = (v: number) => Math.abs(v / GRID - Math.round(v / GRID)) < 1e-6;

type Seen = { name: string; lat: number; lng: number };

/** Every object in a reply that looks like a person on the map (name + coordinates), wherever it sits. */
function peopleIn(node: unknown, out: Seen[] = []): Seen[] {
  if (Array.isArray(node)) node.forEach((n) => peopleIn(n, out));
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.lat === "number" && typeof o.lng === "number" && typeof o.display_name === "string") {
      out.push({ name: o.display_name, lat: o.lat, lng: o.lng });
    }
    Object.values(o).forEach((v) => peopleIn(v, out));
  }
  return out;
}

let browserRef: Browser;
let raviCtx: BrowserContext | null = null;
let ashaCtx: BrowserContext | null = null;
let raviPage: Page | null = null;

/** Leave staging with Ravi's sharing OFF and no spot, whatever happened. Uses Ravi's own signed-in session. */
async function switchRaviOff(): Promise<void> {
  let ctx = raviCtx;
  let page = raviPage && !raviPage.isClosed() ? raviPage : null;
  let own = false;
  if (!ctx || !page) {
    ctx = await browserRef.newContext({ storageState: RAVI.state });
    page = await ctx.newPage();
    await page.goto("/");
    await expectSignedIn(page);
    own = true;
  }
  try {
    const call = apiAs(ctx.request, await accessToken(page));
    await call("clearMapSpot", {});
    await call("setMapSharing", { on: false, notice: "v1" });
  } finally {
    if (own) await ctx.close();
  }
}

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  // Start from a known state, in case an earlier run was cut short.
  await switchRaviOff();
});

test.afterAll(async () => {
  try {
    await switchRaviOff();
  } finally {
    await raviCtx?.close().catch(() => undefined);
    await ashaCtx?.close().catch(() => undefined);
  }
});

test("Ravi shares his spot, Asha sees him at a rounded cell, Ravi hides and he is gone", async ({ browser }) => {
  // ---- 1. Ravi turns "Show my spot to my people" on through the consent sheet -------------------------
  raviCtx = await browser.newContext({
    storageState: RAVI.state,
    permissions: ["geolocation"],
    geolocation: RAVI_AT,
  });
  const ravi = await raviCtx.newPage();
  raviPage = ravi;
  await ravi.goto("/");
  await expectSignedIn(ravi);
  await ravi.getByRole("link", { name: "Settings" }).click();
  await ravi.getByText("App", { exact: true }).first().click();
  await expect(ravi.getByText("Off: you’re hidden (ghost)")).toBeVisible();

  const toggle = ravi.getByRole("switch", { name: "Show my spot to my people" });
  await expect(toggle).toBeEnabled();
  await expect(ravi.getByRole("button", { name: "Hide me now" })).toHaveCount(0);
  await toggle.click();
  await expect(ravi.getByText("Show your spot to your people?")).toBeVisible();
  await ravi.getByRole("button", { name: "Share my spot" }).click();
  // The web switch exposes no checked state; "Hide me now" and the explainer line only show while sharing is on.
  await expect(ravi.getByRole("button", { name: "Hide me now" })).toBeVisible();
  await expect(ravi.getByText("Off: you’re hidden (ghost)")).toHaveCount(0);

  // ---- 2. Asha opens Explore -> My people and waits for Ravi (the spot goes up on Ravi's next ~60 s beat) --
  ashaCtx = await browser.newContext({ storageState: ASHA.state });
  const asha = await ashaCtx.newPage();

  // Every mapPeople reply Asha's app receives (op name is in the request body; the reply is JSON).
  const replies: Seen[][] = [];
  asha.on("response", async (res) => {
    if (!res.url().startsWith(`${SUPABASE_URL}/functions/v1/api`)) return;
    if (!(res.request().postData() ?? "").includes("mapPeople")) return;
    const body = await res.json().catch(() => null);
    if (body) replies.push(peopleIn(body));
  });

  await asha.goto("/");
  await expectSignedIn(asha);
  await asha.getByText("Explore", { exact: true }).first().click();
  const myPeopleChip = asha.getByRole("button", { name: "My people", exact: true });
  const chooseArea = asha.getByRole("button", { name: "Choose your area" });
  await expect(myPeopleChip.or(chooseArea)).toBeVisible();
  // No area means no chips (the map has no centre); the seed account is expected to have one.
  await expect(chooseArea, "Asha has no area chosen, so the map shows no layer chips").toBeHidden();
  await myPeopleChip.click();

  const raviRow = asha.getByRole("button", { name: /^Ravi, \d+ jobs? together/ });
  // Ask again by flipping the layer (a fresh mapPeople fetch) until Ravi's spot has arrived: no blind waiting.
  await expect
    .poll(
      async () => {
        if (await raviRow.first().isVisible().catch(() => false)) return true;
        await asha.getByRole("button", { name: "Jobs", exact: true }).first().click();
        await myPeopleChip.click();
        await asha.waitForTimeout(4_000);
        return raviRow.first().isVisible().catch(() => false);
      },
      { message: "Ravi shows up in Asha's My people layer", timeout: 200_000, intervals: [5_000] },
    )
    .toBe(true);
  await expect(raviRow.first()).toContainText(/jobs? together/);
  await expect(asha.getByText(/jobs? together/).first()).toBeVisible();

  // ---- 3. Privacy: the reply carries rounded cell centres only, never Ravi's real position -----------------
  const raviSeen = replies.flat().filter((p) => /^Ravi\b/.test(p.name));
  expect(raviSeen.length, "a mapPeople reply with Ravi in it was captured").toBeGreaterThan(0);
  const cells = [...new Set(raviSeen.map((p) => `${p.lat},${p.lng}`))];
  console.log(`mapPeople cells seen for Ravi: ${cells.join(" | ")}`);
  for (const p of raviSeen) {
    expect(isOnGrid(p.lat), `lat ${p.lat} is a multiple of ${GRID}`).toBe(true);
    expect(isOnGrid(p.lng), `lng ${p.lng} is a multiple of ${GRID}`).toBe(true);
    expect(p.lat).not.toBe(RAVI_AT.latitude);
    expect(p.lng).not.toBe(RAVI_AT.longitude);
  }

  // ---- 4. Ravi hides; Asha's My people layer no longer lists him ---------------------------------------
  await ravi.getByRole("button", { name: "Hide me now" }).click();
  await expect(ravi.getByText("Off: you’re hidden (ghost)")).toBeVisible();
  await expect(ravi.getByRole("button", { name: "Hide me now" })).toHaveCount(0);

  await expect
    .poll(
      async () => {
        await asha.getByRole("button", { name: "Jobs", exact: true }).first().click();
        await myPeopleChip.click();
        await asha.waitForTimeout(4_000);
        return raviRow.count();
      },
      { message: "Ravi disappears from Asha's My people layer", timeout: 90_000, intervals: [3_000] },
    )
    .toBe(0);
});
