import { test, expect, type Page } from "@playwright/test";
import { ASHA, expectSignedIn, setMode } from "./helpers";

// The Explore tab opens on the full-screen map (plan D20, docs/design/map-tab/PLAN.md). This file runs in the
// desktop project only (see playwright.config.ts: the phone project runs ui.spec.ts alone).
// Assertions stay on the controls, never on the map tiles, which come from the network.
//
// Opening the map asks for the location once per page load (D26: a "Turn on location" sheet covers the page and
// takes every click). The browser here has shared a place (Bengaluru) like a person who tapped "Turn on location",
// so the sheet stays away and the map has a centre; the denied path is its own test at the bottom.
test.use({ geolocation: { latitude: 12.9716, longitude: 77.5946 }, permissions: ["geolocation"] });

const showList = (page: Page) => page.getByRole("button", { name: "Show the list" });
const showMap = (page: Page) => page.getByRole("button", { name: "Show the map" });
const layerChip = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
// A person with no place yet (no location given, no saved area) sees this card in place of the chips.
const chooseArea = (page: Page) => page.getByRole("button", { name: "Type my area", exact: true });
// Plan D23: the distance, pay, type of work and order are set in one Filters sheet.
const pickDistance = async (page: Page, km: number) => {
  const showResults = page.getByRole("button", { name: /^Show [0-9]+ |^No .* yet · Show anyway/ });
  // The panel redraws when its jobs arrive, which can swallow a click on Filters: press it again until the sheet is open.
  await expect(async () => {
    await page.getByRole("button", { name: /^Filters/ }).first().click({ timeout: 5_000 });
    await expect(showResults).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByRole("button", { name: `${km} km`, exact: true }).last().click();
  await showResults.click();
};

test.describe("signed in as the seed poster", () => {
  test.use({ storageState: ASHA.state });

  test("Explore opens on the map with the List control and the layer chips", async ({ page }) => {
    await page.goto("/");
    await expectSignedIn(page);
    await setMode(page, "poster");
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    // The chips are drawn once the map has a place to centre on; the browser shared one, so they must be there.
    await expect(chooseArea(page)).toBeHidden();
    await expect(layerChip(page, "Jobs").first()).toBeVisible();
    await expect(layerChip(page, "Helpers")).toBeVisible();
    await expect(layerChip(page, "People")).toBeVisible();
  });

  test("the List and Map pills switch between the two views, both ways", async ({ page }) => {
    await page.goto("/");
    await expectSignedIn(page);
    await page.getByText("Explore", { exact: true }).first().click();
    await showList(page).click();
    await expect(showMap(page)).toBeVisible();
    await expect(showList(page)).toHaveCount(0);
    await showMap(page).click();
    await expect(showList(page)).toBeVisible();
    await expect(showMap(page)).toHaveCount(0);
  });

  test("the side menu stays next to the map on a wide screen", async ({ page }) => {
    await page.goto("/");
    await expectSignedIn(page);
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    // SideNav items are links (the phone's tab bar has none); "Help & support" is only in the side menu.
    await expect(page.getByRole("link", { name: "Explore" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Help & support" })).toBeVisible();
  });

  test("the side panel hides and comes back on a wide screen", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await expectSignedIn(page);
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    // With no place there is no panel to hide.
    // The browser shares a place (see test.use above), so the map has somewhere to centre on.
    await expect(chooseArea(page)).toBeHidden();
    const heading = page.getByRole("heading", { name: /near you|people nearby/ });
    await expect(heading).toBeVisible();
    await page.getByRole("button", { name: "Hide the panel" }).click();
    await expect(page.getByRole("button", { name: "Show the panel" })).toBeVisible();
    await expect(heading).toBeHidden();
    await page.getByRole("button", { name: "Show the panel" }).click();
    await expect(heading).toBeVisible();
  });

  test("picking a distance in Filters updates the panel words", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await expectSignedIn(page);
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    // The browser shares a place (see test.use above), so the map has somewhere to centre on.
    await expect(chooseArea(page)).toBeHidden();
    await pickDistance(page, 25);
    await expect(page.getByText(/within 25 km/).first()).toBeVisible();
    // Picking a reach is not the person moving the map.
    await expect(page.getByRole("button", { name: "Search this area" })).toHaveCount(0);
  });

  test("the Remote switch shows only jobs with no pin, and All brings the rest back", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await expectSignedIn(page);
    await setMode(page, "worker");
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    // The browser shares a place (see test.use above), so the map has somewhere to centre on.
    await expect(chooseArea(page)).toBeHidden();
    // Since D27 the old "From home" switch is the Remote end of the All / Nearby / Remote control.
    const work = page.getByLabel("Nearby or remote").first();
    await work.getByRole("button", { name: "Remote", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Remote work" })).toBeVisible();
    await expect(page.getByText(/from anywhere/).first()).toBeVisible();
    await work.getByRole("button", { name: "All", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Work near you" })).toBeVisible();
  });

  test("the Home search bar opens Explore as the list, not the map", async ({ page }) => {
    await page.goto("/");
    await expectSignedIn(page);
    // The search bar is on the Earn home (workers find jobs there), so flip the mode switch first.
    await setMode(page, "worker");
    await page.getByLabel("Search jobs").first().click();
    // Home passes focusSearch (no text yet): the list shows with its search box, and the map pill to go back.
    await expect(showMap(page)).toBeVisible();
    await expect(page.getByPlaceholder("E.g. data entry, logo design, home tutoring…")).toBeVisible();
    await expect(showList(page)).toHaveCount(0);
  });
});

test.describe("as a guest", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guest sees the map but no People chip", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Skip sign-up for now" }).click();
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    await expect(layerChip(page, "People")).toHaveCount(0);
  });

  test("a guest can change the reach and still sees the layer chips", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Skip sign-up for now" }).click();
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    await expect(chooseArea(page)).toBeHidden();
    await pickDistance(page, 50);
    await expect(page.getByText(/within 50 km/).first()).toBeVisible();
    await expect(layerChip(page, "Jobs")).toBeVisible();
    await expect(layerChip(page, "Helpers")).toBeVisible();
  });
});

// D21 (docs/design/map-feel-d21/PLAN.md): the web map zooms like Google Maps. The wheel, a trackpad pinch
// (Ctrl + wheel) and a double-click zoom the MAP and never the page. Since D23 the map moves over the whole world.
// The map element carries data-zoom and data-centre for these checks; tiles are never asserted.
test.describe("D21: the map zooms like Google Maps (guest)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const glMap = (page: Page) => page.locator("[data-zoom]").first();
  const zoomOf = async (page: Page) => Number(await glMap(page).getAttribute("data-zoom"));
  const openMap = async (page: Page) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Skip sign-up for now" }).click();
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(glMap(page)).toHaveAttribute("data-zoom", /\d/);
    // Remember whether the page let the browser handle the last wheel (it must not, over the map).
    await page.evaluate(() => {
      window.addEventListener("wheel", (e) => ((window as unknown as { lastWheelPrevented: boolean }).lastWheelPrevented = e.defaultPrevented));
    });
    // The map redraws once when the shared place arrives; measure it after that.
    await expect(page.getByLabel("Your location")).toBeVisible();
    await expect.poll(async () => (await glMap(page).boundingBox()) !== null).toBe(true);
    const box = (await glMap(page).boundingBox())!;
    return { x: box.x + box.width * 0.7, y: box.y + box.height / 2 };
  };
  const settle = (page: Page) => page.waitForTimeout(900);
  const prevented = (page: Page) => page.evaluate(() => (window as unknown as { lastWheelPrevented?: boolean }).lastWheelPrevented);

  test("the mouse wheel zooms the map in and out, and the page does not get the wheel", async ({ page }) => {
    const at = await openMap(page);
    const before = await zoomOf(page);
    await page.mouse.move(at.x, at.y);
    await page.mouse.wheel(0, -400);
    await settle(page);
    const zoomedIn = await zoomOf(page);
    expect(zoomedIn).toBeGreaterThan(before);
    expect(await prevented(page)).toBe(true);
    await page.mouse.wheel(0, 400);
    await settle(page);
    expect(await zoomOf(page)).toBeLessThan(zoomedIn);
  });

  test("a trackpad pinch (Ctrl + wheel) zooms the map, not the browser page", async ({ page }) => {
    const at = await openMap(page);
    const before = await zoomOf(page);
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -200);
    await page.keyboard.up("Control");
    await settle(page);
    expect(await zoomOf(page)).toBeGreaterThan(before);
    // The browser's own zoom only happens when the page leaves Ctrl + wheel alone.
    expect(await prevented(page)).toBe(true);
  });

  test("a double-click zooms in one step", async ({ page }) => {
    const at = await openMap(page);
    const before = await zoomOf(page);
    await page.mouse.dblclick(at.x, at.y);
    await settle(page);
    expect(await zoomOf(page)).toBeGreaterThan(before + 0.5);
  });

  test("dragging far west goes past India (owner video, 9 Nov: move over the whole globe)", async ({ page }) => {
    const at = await openMap(page);
    // Start from a country-sized view: the browser shared a place, so the map opens zoomed in on the city,
    // and six drags there only move a few kilometres.
    for (let i = 0; i < 12 && (await zoomOf(page)) > 4; i++) {
      await page.getByRole("button", { name: "Zoom out" }).click();
      await page.waitForTimeout(400);
    }
    expect(await zoomOf(page)).toBeLessThanOrEqual(4);
    // One drag of 600 px at this zoom is 25 to 50 degrees: from the middle of India (77°E) that is past 58°E, and
    // short of the other side of the globe (more drags wrap round to the far east, which proves nothing).
    await page.mouse.move(at.x - 300, at.y);
    await page.mouse.down();
    await page.mouse.move(at.x + 300, at.y, { steps: 8 });
    await page.mouse.up();
    await settle(page);
    const [, lng] = (await glMap(page).getAttribute("data-centre"))!.split(",").map(Number);
    // The map used to stop at 58°E (INDIA_BOUNDS); now it carries on west.
    expect(lng).toBeLessThan(58);
  });

  test("the List view never shows an empty box at the top", async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/");
    await page.getByRole("button", { name: "Skip sign-up for now" }).click();
    await page.getByText("Explore", { exact: true }).first().click();
    await showList(page).click();
    // A guest with no area sees the one-line card; with an area, the map strip and its button.
    await expect(page.getByText("Set your area", { exact: true }).or(page.getByText("Open the map", { exact: true })).filter({ visible: true }).first()).toBeVisible({ timeout: 8000 });
  });
});

// Nothing shared: the map asks once for the location (a sheet over the page), and "Not now" leaves the card
// with its two buttons. This is the path the tests above avoid by sharing a place.
test.describe("a guest who shares no location", () => {
  test.use({ storageState: { cookies: [], origins: [] }, permissions: [] });

  test("Explore asks for the location, and Not now leaves the card to use the location or type an area", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Skip sign-up for now" }).click();
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(page.getByText("Turn on location for the best Explore experience")).toBeVisible();
    await page.getByRole("button", { name: "Not now", exact: true }).click();
    await expect(page.getByText("Turn on location for the best Explore experience")).toBeHidden();
    await expect(chooseArea(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Use my location", exact: true })).toBeVisible();
  });
});
