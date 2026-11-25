import { expect, test, type Page } from "@playwright/test";
import { ASHA } from "./helpers";

/**
 * Plan 1.19 row N: "How TaskDrop works", the one walkthrough. Asha (a seed account, fake data) opens it from the
 * account menu and from Profile, walks the five real screens on Hire, switches to Earn, and closes it. It is
 * read-only: nothing may be sent to the server while it is open. (It replaces tour.spec.ts.)
 */

const heading = (page: Page, name: string) => page.getByRole("heading", { name });

async function home(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Wallet").first()).toBeVisible();
  const staging = page.getByRole("button", { name: "Got it", exact: true });
  if (await staging.isVisible({ timeout: 3000 }).catch(() => false)) await staging.click();
  await page.getByText("Hire", { exact: true }).first().click();
}

test.use({ storageState: ASHA.state });

test("the account menu opens the walkthrough: five real Hire screens, then the Earn side, and nothing is sent", async ({ page }) => {
  await home(page);
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/functions/v1/api")) writes.push(r.postData() ?? "");
  });

  await page.getByLabel("Account menu").click();
  await page.getByText("How TaskDrop works", { exact: true }).click();
  await expect(heading(page, "How TaskDrop works")).toBeVisible();
  await expect(page.getByText("Ask for anything. Someone gets it done for you.").last()).toBeVisible();
  // The YouTube link is not filled in yet, so there is no video button (lib/walkthrough.ts).
  await expect(page.getByRole("link", { name: "Watch the video", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Show me the app", exact: true }).click();
  const hire = ["Say what you need", "See who is near you", "Offers come to you", "Your money is held safely", "Approve, and they are paid"];
  for (const [n, title] of hire.entries()) {
    await expect(heading(page, title)).toBeVisible();
    await expect(page.getByText(`STEP ${n + 1} OF 5`)).toBeVisible();
    await expect(page.getByLabel(`TaskDrop screen: ${title}`)).toBeVisible();
    await page.getByRole("button", { name: n === 4 ? "Done" : "Next", exact: true }).click();
  }
  await expect(heading(page, "You’re set")).toBeVisible();
  await expect(page.getByRole("button", { name: "Post a request", exact: true }).last()).toBeVisible();

  // The other side starts again from its first card.
  await page.getByRole("tab", { name: "Earn side" }).click();
  await expect(page.getByText("Do tasks near you or online, and get paid.")).toBeVisible();
  await page.getByRole("button", { name: "Show me the app", exact: true }).click();
  await expect(heading(page, "Find work near you or online")).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(heading(page, "Send your price")).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(heading(page, "Find work near you or online")).toBeVisible();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(heading(page, "How TaskDrop works")).toHaveCount(0);
  expect(writes, "the walkthrough must not write anything").toEqual([]);
});

test("Profile has How TaskDrop works, and the old practice tour is gone", async ({ page }) => {
  await home(page);
  await page.getByLabel("Account menu").click();
  await expect(page.getByText("Take the app tour", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.goto("/profile");
  await page.getByText("How TaskDrop works", { exact: true }).first().click();
  await expect(heading(page, "How TaskDrop works")).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
});
