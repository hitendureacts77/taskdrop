import { test, expect, type Page } from "@playwright/test";
import { ASHA, expectSignedIn } from "./helpers";

// Plan D24 (owner video, 10 Nov): on a phone the Explore map fills the screen and a slim bar at the
// bottom pulls up the list, by a tap, a drag or the mouse wheel. Runs at the size of the owner's
// screen recording. Assertions stay on the controls and boxes, never on the map tiles.

test.use({ storageState: ASHA.state, viewport: { width: 400, height: 608 }, hasTouch: true });

const seeAll = (page: Page) => page.getByRole("button", { name: /See all$/ });
const showMap = (page: Page) => page.getByRole("button", { name: "Show more of the map" });
const shot = (page: Page, name: string) => (process.env.PEEK_SHOTS ? page.screenshot({ path: `${process.env.PEEK_SHOTS}/${name}.png` }) : Promise.resolve());

async function openMap(page: Page): Promise<boolean> {
  await page.goto("/");
  await expectSignedIn(page);
  await page.getByText("Explore", { exact: true }).first().click();
  // With no area yet the map asks for one instead; there is no bar then.
  await expect(seeAll(page).or(page.getByRole("button", { name: "Choose your area" })).first()).toBeVisible({ timeout: 15_000 });
  return seeAll(page).isVisible();
}

/** How much of the screen height the bar takes, from the top of its "See all" row to the screen bottom. */
async function barHeight(page: Page): Promise<number> {
  const box = await seeAll(page).boundingBox();
  return box ? 608 - box.y : 608;
}

test.describe("the phone map's pull-up bar", () => {
  test("rests low so the map fills the screen, and the layer chips stay on it", async ({ page }) => {
    test.skip(!(await openMap(page)), "this account has no area yet");
    await shot(page, "1-peek");
    // The old card took about half the screen; the bar leaves the map most of it.
    expect(await barHeight(page)).toBeLessThan(200);
    await expect(page.getByRole("button", { name: "Jobs", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Helpers", exact: true })).toBeVisible();
  });

  test("a tap on See all opens the list, and Map folds it back down", async ({ page }) => {
    test.skip(!(await openMap(page)), "this account has no area yet");
    await seeAll(page).click();
    await expect(showMap(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Show the map" })).toBeVisible();
    // Pulled up, the sheet takes most of the screen, so the list has room even on a short phone.
    const top = (await showMap(page).boundingBox())!;
    expect(top.y).toBeLessThan(608 / 2);
    await expect(page.getByText("Looking around…")).toHaveCount(0, { timeout: 15_000 });
    await shot(page, "2-up");
    await page.getByRole("button", { name: "Show the map" }).click();
    await expect(seeAll(page)).toBeVisible();
  });

  test("dragging the bar up opens the list, and dragging the handle down closes it", async ({ page }) => {
    test.skip(!(await openMap(page)), "this account has no area yet");
    const box = (await seeAll(page).boundingBox())!;
    // Start on the words, not the button: the whole bar is the drag area.
    const x = 60;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x, y - i * 25);
    await shot(page, "3-mid-drag");
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Show the map" })).toBeVisible();

    // The sheet springs up; measure the handle once it has stopped moving.
    let handle = (await showMap(page).boundingBox())!;
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(100);
      const now = (await showMap(page).boundingBox())!;
      if (Math.abs(now.y - handle.y) < 0.5) break;
      handle = now;
    }
    const hx = handle.x + handle.width / 2;
    const hy = handle.y + handle.height / 2;
    await page.mouse.move(hx, hy);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(hx, hy + i * 30);
    await page.mouse.up();
    await expect(seeAll(page)).toBeVisible();
  });

  test("the mouse wheel over the bar opens the list", async ({ page }) => {
    test.skip(!(await openMap(page)), "this account has no area yet");
    const box = (await seeAll(page).boundingBox())!;
    await page.mouse.move(60, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    await expect(page.getByRole("button", { name: "Show the map" })).toBeVisible();
  });
});
