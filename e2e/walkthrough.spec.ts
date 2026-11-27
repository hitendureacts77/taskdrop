import { expect, test, type Page } from "@playwright/test";
import { ASHA, closeStagingCard } from "./helpers";

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

test("the account menu opens the walkthrough: five real Hire screens, then the Earn side", async ({ page }) => {
  await home(page);
  await page.getByLabel("Account menu").click();
  await page.getByText("How TaskDrop works", { exact: true }).click();
  await expect(heading(page, "How TaskDrop works").first()).toBeVisible();
  // The YouTube link is not filled in yet, so there is no video button (lib/walkthrough.ts).
  await expect(page.getByRole("link", { name: /Watch the video/ })).toHaveCount(0);

  // It plays by itself; pause it, then step with the controls. The screen is drawn whole (contain, exact shape).
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const hire = ["Say what you need", "See who is near you", "Offers come to you", "Your money is held safely", "Approve, and they are paid"];
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
  await expect(heading(page, "Your money is held safely")).toBeVisible();
  await page.getByRole("button", { name: "Step 2: See who is near you" }).click();
  await expect(heading(page, "See who is near you")).toBeVisible();

  // The other side starts again from its first step.
  await page.getByRole("tab", { name: "Earn side" }).click();
  await expect(heading(page, "Find work near you or online")).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.getByRole("button", { name: "Next step", exact: true }).click();
  await expect(heading(page, "Send your price")).toBeVisible();
  await page.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(heading(page, "Find work near you or online")).toBeVisible();
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

test("Home has the small Help improve TaskDrop card, and Suggest a feature opens the idea sheet", async ({ page }) => {
  await home(page);
  const card = page.getByText("Help improve TaskDrop", { exact: true }).first();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  await page.getByRole("button", { name: "Suggest a feature", exact: true }).first().click();
  await expect(page.getByText("Suggest an idea").first()).toBeVisible();
});

test("signed in on a device that never saw it, the walkthrough opens once by itself on Home", async ({ page }) => {
  // This browser has Asha's sign-in but has never shown "How TaskDrop works" (the lib/intro.ts key is cleared once).
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("wt-once")) {
      localStorage.setItem("taskdrop.intro.v1", "0");
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
