import { expect, test, type Page } from "@playwright/test";
import { ASHA, answerConsent, closeStagingCard } from "./helpers";

/**
 * Plan 1.19 row N: "How TaskDrop works", the one walkthrough. Asha (a seed account, fake data) opens it from the
 * account menu and from Profile, walks the five real screens on Hire, switches to Earn, and closes it. (It replaces tour.spec.ts.)
 */

const heading = (page: Page, name: string) => page.getByRole("heading", { name, exact: true });

async function home(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Wallet").first()).toBeVisible();
  await closeStagingCard(page);
  await page.getByText("Hire", { exact: true }).first().click();
}

test.use({ storageState: ASHA.state });

test("the account menu opens the walkthrough: five real Hire screens with the map last, then the Earn side", async ({ page }) => {
  await home(page);
  await page.getByLabel("Account menu").click();
  await page.getByText("How TaskDrop works", { exact: true }).click();
  await expect(heading(page, "How TaskDrop works").first()).toBeVisible();
  // The YouTube link is not filled in yet, so there is no video button (lib/walkthrough.ts).
  await expect(page.getByRole("link", { name: /Watch the video/ })).toHaveCount(0);

  // It plays by itself; pause it, then step with the controls. The screen is drawn whole (contain, exact shape).
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const hire = ["Say what you need", "Offers come to you", "Your money is held safely", "Approve, and they are paid", "See who is near you"];
  for (const [n, title] of hire.entries()) {
    await expect(heading(page, title)).toBeVisible();
    await expect(page.getByText(`Step ${n + 1} of 5`)).toBeVisible();
    const shot = page.getByLabel(`TaskDrop screen: ${title}`);
    await expect(shot).toBeVisible();
    const box = await shot.boundingBox();
    expect(Math.abs(box!.width / box!.height - 488 / 835)).toBeLessThan(0.01);
    if (n < 4) await page.getByRole("button", { name: "Next step", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: "Post a request", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(heading(page, "Approve, and they are paid")).toBeVisible();
  await page.getByRole("button", { name: "Step 2: Offers come to you" }).click();
  await expect(heading(page, "Offers come to you")).toBeVisible();

  // The other side starts again from its first step.
  await page.getByRole("tab", { name: "Earn side" }).click();
  await expect(heading(page, "Find work near you or online")).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(heading(page, "Send your price")).toBeVisible();
  await page.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(heading(page, "Find work near you or online")).toBeVisible();
  // Earn has six screens; the map is the last one.
  await page.getByRole("button", { name: "Step 6: See work on the map" }).click();
  await expect(heading(page, "See work on the map")).toBeVisible();
  await expect(page.getByText("Step 6 of 6")).toBeVisible();
  await expect(page.getByRole("button", { name: "Find work", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(heading(page, "How TaskDrop works")).toHaveCount(0);
});

test("Profile has How TaskDrop works, and the old practice tour is gone", async ({ page }) => {
  await home(page);
  await page.getByLabel("Account menu").click();
  await expect(page.getByText("Take the app tour", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByText("Profile", { exact: true }).first().click();
  await page.getByText("How TaskDrop works", { exact: true }).first().click();
  await expect(heading(page, "How TaskDrop works")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
});

test("Help & support: one Get help form, links in a short list, rarely used pages under More", async ({ page }) => {
  await home(page);
  await page.getByText("Profile", { exact: true }).first().click();
  await page.getByText("Help & support", { exact: true }).first().click();
  await expect(page.getByText("Get help", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send message", exact: true })).toBeVisible();
  await expect(page.getByText("Terms of Service", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /^More/ }).click();
  for (const name of ["Copyright and takedowns", "Security reports and contact", "Terms of Service", "Privacy Policy"]) {
    await expect(page.getByRole("button", { name }).first()).toBeVisible();
  }
});

test("Home has the small Help improve TaskDrop card, and Suggest a feature opens the idea sheet", async ({ page }) => {
  await home(page);
  const card = page.getByText("Help improve TaskDrop", { exact: true }).first();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Suggest a feature", exact: true }).first().click();
  await expect(page.getByText("Suggest an idea").first()).toBeVisible();
});

test("signed in on a device that never saw it, the walkthrough opens once by itself on Home", async ({ page }) => {
  // This browser has Asha's sign-in but has never shown "How TaskDrop works" (her walkSeenKey is cleared once).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("wt-once")) {
      for (const k of Object.keys(localStorage)) if (k.startsWith("taskdrop.walk.seen.v2.")) localStorage.removeItem(k);
      sessionStorage.setItem("wt-once", "1");
    }
  });
  await page.goto("/");
  // The tester card comes first if this browser has not closed it; the walkthrough follows on its own.
  const staging = page.getByRole("button", { name: "Got it", exact: true });
  await staging.or(heading(page, "How TaskDrop works")).first().waitFor({ timeout: 30_000 });
  if (await staging.isVisible().catch(() => false)) await staging.click();
  await expect(heading(page, "How TaskDrop works")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.getByText("Wallet").first()).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(heading(page, "How TaskDrop works")).toHaveCount(0);
});

test("the picture fits the screen whole, above the caption, and each step says what it is for (28 Nov)", async ({ page }) => {
  await home(page);
  await page.getByLabel("Account menu").click();
  await page.getByText("How TaskDrop works", { exact: true }).click();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  const title = "See who is near you";
  await expect(heading(page, title)).toBeVisible();
  await expect(page.getByText("See helpers and services around you at a glance.", { exact: true })).toBeVisible();
  const vp = page.viewportSize()!;
  const shot = (await page.getByLabel(`TaskDrop screen: ${title}`).boundingBox())!;
  const head = (await heading(page, title).boundingBox())!;
  expect(Math.abs(shot.width / shot.height - 488 / 835)).toBeLessThan(0.01);
  expect(shot.y).toBeGreaterThanOrEqual(0);
  expect(shot.y + shot.height).toBeLessThanOrEqual(vp.height + 1);
  expect(shot.x + shot.width).toBeLessThanOrEqual(vp.width + 1);
  // Phone: the picture sits above the caption card, never under it.
  if (vp.width < 600) expect(shot.y + shot.height).toBeLessThanOrEqual(head.y);
});

test.describe("a fresh signed-out browser (owner, 27 Nov: never on the sign-in page, once after Continue as guest)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the sign-in page does not show it; Continue as guest lands on Home and it opens once by itself", async ({ page }) => {
    await page.goto("/");
    await answerConsent(page);
    await expect(page.getByPlaceholder("98765 43210")).toBeVisible();
    await page.waitForTimeout(1500);
    await expect(heading(page, "How TaskDrop works")).toHaveCount(0);

    await page.getByRole("button", { name: "Continue as guest" }).click();
    // The tester card comes first if shown; the walkthrough follows on its own.
    const staging = page.getByRole("button", { name: "Got it", exact: true });
    await staging.or(heading(page, "How TaskDrop works")).first().waitFor({ timeout: 30_000 });
    if (await staging.isVisible().catch(() => false)) await staging.click();
    await expect(heading(page, "How TaskDrop works")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(heading(page, "How TaskDrop works")).toHaveCount(0);

    // A reload does not open it again.
    await page.reload();
    await page.waitForTimeout(3000);
    await expect(heading(page, "How TaskDrop works")).toHaveCount(0);
  });
});
