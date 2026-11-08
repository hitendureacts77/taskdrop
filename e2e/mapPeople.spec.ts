import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { ASHA, MEERA, RAVI, SUPABASE_URL, accessToken, apiAs, expectSignedIn } from "./helpers";

// The People layer end to end (docs/design/map-tab/PLAN.md: WP4b layer, WP6 consent sheet; owner decision 35b).
// Cloud TEST project, seed accounts.
//   1. Ravi (worker) shares his spot, Asha (poster) sees him in her People layer at a rounded cell, then Ravi hides.
//      Seed Asha and Ravi share many COMPLETED tasks, so they are "my people" for each other.
//   2. Meera, a stranger to Asha, chooses "Everyone nearby": Asha sees her as "Nearby" on a coarser cell (0.02
//      degrees, first name only); when Meera goes back to "My people" she is gone from Asha's map.
// Desktop project only. Assertions stay on controls and text, never on map tiles.

// Madhapur, Hyderabad. The device snaps this to the 0.005-degree grid before it sends anything.
const RAVI_AT = { latitude: 17.4486, longitude: 78.3908 };
const GRID = 0.005;
const STRANGER_GRID = 0.02;
// Where Meera shares from (near Asha's area); the server rounds it twice, to 0.005 and then to 0.02 degrees.
const MEERA_AT = { lat: 17.4601, lng: 78.4003 };

test.setTimeout(300_000);

const isOnGrid = (v: number, grid = GRID) => Math.abs(v / grid - Math.round(v / grid)) < 1e-6;

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

/** Leave staging with this person's sharing OFF and no spot, whatever happened. Uses their own signed-in session. */
async function switchOff(state: string, existing?: { ctx: BrowserContext | null; page: Page | null }): Promise<void> {
  let ctx = existing?.ctx ?? null;
  let page = existing?.page && !existing.page.isClosed() ? existing.page : null;
  let own = false;
  if (!ctx || !page) {
    ctx = await browserRef.newContext({ storageState: state });
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

const switchRaviOff = () => switchOff(RAVI.state, { ctx: raviCtx, page: raviPage });
const switchMeeraOff = () => switchOff(MEERA.state);

test.beforeAll(async ({ browser }) => {
  browserRef = browser;
  // Start from a known state, in case an earlier run was cut short.
  await switchRaviOff();
  await switchMeeraOff();
});

test.afterAll(async () => {
  try {
    await switchRaviOff();
    await switchMeeraOff();
  } finally {
    await raviCtx?.close().catch(() => undefined);
    await ashaCtx?.close().catch(() => undefined);
  }
});

test("Ravi shares his spot, Asha sees him at a rounded cell, Ravi hides and he is gone", async ({ browser }) => {
  // ---- 1. Ravi turns "Show my spot on the map" on through the consent sheet (default audience: my people) ---
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

  const toggle = ravi.getByRole("switch", { name: "Show my spot on the map" });
  await expect(toggle).toBeEnabled();
  await expect(ravi.getByRole("button", { name: "Hide me now" })).toHaveCount(0);
  await toggle.click();
  await expect(ravi.getByText("Show your spot on the map?")).toBeVisible();
  await expect(ravi.getByRole("radio", { name: "My people" })).toBeVisible();
  await expect(ravi.getByRole("radio", { name: "Everyone nearby" })).toBeVisible();
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
  const myPeopleChip = asha.getByRole("button", { name: "People", exact: true });
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
      { message: "Ravi disappears from Asha's People layer", timeout: 90_000, intervals: [3_000] },
    )
    .toBe(0);
});

test("Meera, a stranger, chooses Everyone nearby: Asha sees her as Nearby on a coarse cell, then she is gone", async ({ browser }) => {
  // Meera shares through her own signed-in session (the consent sheet is covered by the test above).
  const meeraCtx = await browser.newContext({ storageState: MEERA.state });
  const asha2Ctx = await browser.newContext({ storageState: ASHA.state });
  try {
    const meeraPage = await meeraCtx.newPage();
    await meeraPage.goto("/");
    await expectSignedIn(meeraPage);
    const meera = apiAs(meeraCtx.request, await accessToken(meeraPage));
    expect((await meera("setMapSharing", { on: true, notice: "v1" })).ok, "Meera switched sharing on").toBe(true);
    // "Everyone nearby" needs the newer notice: the old one is refused.
    const tooOld = await meera("setMapAudience", { audience: "everyone", notice: "v1" });
    expect(tooOld.ok, "everyone is refused under the old notice").toBe(false);
    expect((await meera("setMapAudience", { audience: "everyone", notice: "v2" })).ok, "Meera chose everyone").toBe(true);
    expect((await meera("touchPresence", { spot: MEERA_AT })).ok).toBe(true);

    const asha = await asha2Ctx.newPage();
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
    const peopleChip = asha.getByRole("button", { name: "People", exact: true });
    await expect(asha.getByRole("button", { name: "Choose your area" }), "Asha has an area chosen").toBeHidden();
    await peopleChip.click();

    const meeraRow = asha.getByRole("button", { name: /^Meera.*Nearby/ });
    await expect(meeraRow.first(), "Meera shows up as Nearby").toBeVisible({ timeout: 60_000 });
    await expect(meeraRow.first()).not.toContainText(/jobs? together/);

    // Privacy: a stranger comes back on the coarse 0.02-degree cell, never the finer one or the real position.
    const seen = replies.flat().filter((p) => /^Meera\b/.test(p.name));
    expect(seen.length, "a mapPeople reply with Meera in it was captured").toBeGreaterThan(0);
    for (const p of seen) {
      expect(p.name, "a stranger's name is the first name only").toMatch(/^\S+$/);
      expect(isOnGrid(p.lat, STRANGER_GRID), `lat ${p.lat} is a multiple of ${STRANGER_GRID}`).toBe(true);
      expect(isOnGrid(p.lng, STRANGER_GRID), `lng ${p.lng} is a multiple of ${STRANGER_GRID}`).toBe(true);
      expect(p.lat).not.toBe(MEERA_AT.lat);
      expect(p.lng).not.toBe(MEERA_AT.lng);
    }

    // Back to "My people" only: she disappears from the stranger's map.
    expect((await meera("setMapAudience", { audience: "people", notice: "v1" })).ok).toBe(true);
    await expect
      .poll(
        async () => {
          await asha.getByRole("button", { name: "Jobs", exact: true }).first().click();
          await peopleChip.click();
          await asha.waitForTimeout(3_000);
          return meeraRow.count();
        },
        { message: "Meera disappears from Asha's People layer", timeout: 60_000, intervals: [3_000] },
      )
      .toBe(0);
  } finally {
    await switchMeeraOff();
    await meeraCtx.close().catch(() => undefined);
    await asha2Ctx.close().catch(() => undefined);
  }
});
