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

test("the account menu plays the animated story straight away, no \"Show me the app\" question", async ({ page }) => {
  await home(page);
  await page.getByLabel("Account menu").click();
  await page.getByText("How TaskDrop works", { exact: true }).click();
  await expect(heading(page, "How TaskDrop works")).toBeVisible();
  await expect(page.getByRole("button", { name: /^How TaskDrop works, part 1 of 5/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Show me the app", exact: true })).toHaveCount(0);
  await expect(page.getByText("STEP 1 OF 5")).toHaveCount(0);
  // Tapping the picture goes to the next part.
  await page.getByRole("button", { name: /^How TaskDrop works, part 1 of 5/ }).click();
  await expect(page.getByRole("button", { name: /^How TaskDrop works, part 2 of 5/ })).toBeVisible();
  // The Earn side tells the earn parts.
  await page.getByRole("tab", { name: "Earn side" }).click();
  await expect(page.getByRole("button", { name: /^How TaskDrop works, part 1 of 6.*Find work near you/ })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(heading(page, "How TaskDrop works")).toHaveCount(0);
});

test("Profile has How TaskDrop works, and it plays the story", async ({ page }) => {
  await home(page);
  await page.getByLabel("Account menu").click();
  await expect(page.getByText("Take the app tour", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByText("Profile", { exact: true }).first().click();
  await page.getByText("How TaskDrop works", { exact: true }).first().click();
  await expect(heading(page, "How TaskDrop works")).toBeVisible();
  await expect(page.getByRole("button", { name: /^How TaskDrop works, part 1 of/ })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
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
