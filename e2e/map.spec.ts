import { test, expect, type Page } from "@playwright/test";
import { ASHA, expectSignedIn } from "./helpers";

// The Explore tab opens on the full-screen map (plan D20, docs/design/map-tab/PLAN.md). This file runs in the
// desktop project only (see playwright.config.ts: the phone project runs ui.spec.ts alone).
// Assertions stay on the controls, never on the map tiles, which come from the network.

const showList = (page: Page) => page.getByRole("button", { name: "Show the list" });
const showMap = (page: Page) => page.getByRole("button", { name: "Show the map" });
const layerChip = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
// A person with no area yet sees this prompt in place of the chips.
const chooseArea = (page: Page) => page.getByRole("button", { name: "Choose your area" });

test.describe("signed in as the seed poster", () => {
  test.use({ storageState: ASHA.state });

  test("Explore opens on the map with the List control and the layer chips", async ({ page }) => {
    await page.goto("/");
    await expectSignedIn(page);
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    // The chips are drawn once the map has an area to centre on; until then the area prompt takes their place.
    await expect(layerChip(page, "Jobs").or(chooseArea(page))).toBeVisible();
    if (await chooseArea(page).isHidden()) {
      await expect(layerChip(page, "Helpers")).toBeVisible();
      await expect(layerChip(page, "My people")).toBeVisible();
    }
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

  test("the Home search bar opens Explore as the list, not the map", async ({ page }) => {
    await page.goto("/");
    await expectSignedIn(page);
    // The search bar is on the Earn home (workers find jobs there), so flip the mode switch first.
    await page.getByLabel("Earn mode").first().click();
    await page.getByLabel("Search jobs").first().click();
    // Home passes focusSearch (no text yet): the list shows with its search box, and the map pill to go back.
    await expect(showMap(page)).toBeVisible();
    await expect(page.getByPlaceholder("E.g. data entry, logo design, home tutoring…")).toBeVisible();
    await expect(showList(page)).toHaveCount(0);
  });
});

test.describe("as a guest", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a guest sees the map but no My people chip", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Continue as guest").click();
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(showList(page)).toBeVisible();
    await expect(layerChip(page, "My people")).toHaveCount(0);
  });
});
