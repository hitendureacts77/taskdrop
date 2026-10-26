import { test, expect } from "@playwright/test";
import { ASHA, expectSignedIn } from "./helpers";

// The screens, at desktop and phone sizes (see the two projects in playwright.config.ts).

test.describe("signed out", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("the front door asks for a mobile number and offers Google and username", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Text me a code")).toBeVisible();
    await expect(page.getByText("Google", { exact: true })).toBeVisible();
    await expect(page.getByText("Username", { exact: true })).toBeVisible();
    await expect(page.getByText("Terms").first()).toBeVisible();
  });

  test("a number that is too short does not get a code", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("98765 43210").fill("12345");
    await page.getByText("Text me a code").click();
    await expect(page.getByText("Enter the code we just texted")).toHaveCount(0);
  });

  test("the staging ribbon shows on the front door, and the staging site asks search engines to stay out", async ({ page, request }) => {
    await page.goto("/");
    await expect(page.getByText("Staging: fake money and fake data")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toMatch(/User-agent: \*\s+Disallow: \//);
  });

  test("Terms and Privacy carry the staging notice", async ({ page }) => {
    for (const name of ["terms", "privacy"]) {
      await page.goto(`/?page=${name}`);
      await expect(page.getByText("staging copy of TaskDrop")).toBeVisible();
    }
  });

  test("the legal pages are public", async ({ page }) => {
    for (const name of ["terms", "privacy", "support"]) {
      await page.goto(`/?page=${name}`);
      await expect(page.locator("body")).not.toContainText("Text me a code");
    }
  });
});

test.describe("signed in as the seed poster", () => {
  test.use({ storageState: ASHA.state });

  test("home loads with the signed-in navigation and no crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("/");
    await expectSignedIn(page);
    expect(errors).toEqual([]);
  });

  test("the wallet shows money in rupees", async ({ page, isMobile }) => {
    await page.goto("/");
    await expectSignedIn(page);
    await page.getByText("Wallet", { exact: true }).first().click();
    await expect(page.locator("body")).toContainText("₹", { timeout: 20_000 });
    if (!isMobile) await expect(page.getByText("Withdraw").first()).toBeVisible();
  });

  test("a task can be opened from the feed", async ({ page }) => {
    await page.goto("/");
    await expectSignedIn(page);
    await page.getByText("Explore", { exact: true }).first().click();
    await expect(page.locator("body")).toContainText("₹", { timeout: 20_000 });
  });
});
