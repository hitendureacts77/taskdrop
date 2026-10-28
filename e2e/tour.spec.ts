import { expect, test, type Page } from "@playwright/test";
import { ASHA } from "./helpers";

/**
 * Phase 8: the app tour. Asha (a seed account, fake data) opens it from the account menu and walks the
 * whole hiring side by tapping each lit-up control, then does it again and skips. The tour is a pretend
 * task: nothing may be sent to the server, and the Hire/Earn switch must be back where she left it.
 */

const heading = (page: Page, name: string) => page.getByRole("heading", { name });
const tap = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true }).click();

async function openTour(page: Page) {
  await page.goto("/");
  await expect(page.getByText("Wallet").first()).toBeVisible();
  // A fresh browser is first shown "How staging works"; the tour waits for it and so does this test.
  const staging = page.getByRole("button", { name: "Got it", exact: true });
  if (await staging.isVisible({ timeout: 3000 }).catch(() => false)) await staging.click();
  await page.getByText("Hire", { exact: true }).first().click();
  await page.getByLabel("Account menu").click();
  await page.getByText("Take the app tour", { exact: true }).click();
}

/** On Hire the side menu offers "Post a request"; on Earn it offers "Offer a service". */
const onHire = (page: Page) => expect(page.getByRole("button", { name: "Post a request", exact: true }).first()).toBeVisible();

test.use({ storageState: ASHA.state });

test("the tour walks post, offers, money held, approve and paid, and changes nothing for real", async ({ page }) => {
  const writes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/functions/v1/api")) writes.push(r.postData() ?? "");
  });

  await openTour(page);
  await expect(heading(page, "One account, two sides")).toBeVisible();
  await tap(page, "Tap Earn");
  await expect(heading(page, "Now you’re earning")).toBeVisible();
  await tap(page, "Tap Hire to switch back");

  await expect(heading(page, "Ask for anything")).toBeVisible();
  // The desktop viewport has no drop button, so the side menu's "Post a request" is lit instead.
  await tap(page, "Tap Post a request");
  await expect(heading(page, "Near you, or online")).toBeVisible();
  await tap(page, "Pick one");
  await expect(heading(page, "Your address stays private")).toBeVisible();
  await tap(page, "Tap Post");
  await expect(heading(page, "Offers come to you")).toBeVisible();
  await expect(page.getByText("EXAMPLE").first()).toBeVisible();
  await tap(page, "Tap an offer");
  await expect(heading(page, "Your money is held safely")).toBeVisible();
  await expect(page.getByText(/plus a 3% service fee/)).toBeVisible();
  await tap(page, "Tap Choose offer");
  await expect(heading(page, "Ravi says the work is done")).toBeVisible();
  await tap(page, "Tap Approve");
  await expect(heading(page, "Paid")).toBeVisible();
  await tap(page, "Next");
  await expect(heading(page, "Everything else, one tap away")).toBeVisible();
  await tap(page, "Next");
  await expect(heading(page, "Five tabs at the bottom")).toBeVisible();
  await tap(page, "Got it");
  await expect(heading(page, "You’re set!")).toBeVisible();
  await tap(page, "Close the tour");

  await expect(heading(page, "You’re set!")).toBeHidden();
  await onHire(page);
  // Pretend means pretend: no task, offer or payment reached the server.
  expect(writes.filter((w) => /createTask|placeBid|chooseBid|approve|createPayment|fundTask/i.test(w))).toEqual([]);
});

test("Skip ends the tour at once and leaves the app as it was", async ({ page }) => {
  await openTour(page);
  await expect(heading(page, "One account, two sides")).toBeVisible();
  await tap(page, "Tap Earn");
  await expect(heading(page, "Now you’re earning")).toBeVisible();
  await page.getByRole("button", { name: "Skip the tour" }).click();
  await expect(heading(page, "Now you’re earning")).toBeHidden();
  // She was hiring when she started; the real switch is back on Hire.
  await onHire(page);
});

test("Esc skips the tour on the web", async ({ page }) => {
  await openTour(page);
  await expect(heading(page, "One account, two sides")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(heading(page, "One account, two sides")).toBeHidden();
});
