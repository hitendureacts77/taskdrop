import { test, expect, type Page } from "@playwright/test";
import { ASHA, expectSignedIn } from "./helpers";

// Task 1.21 row D: one Promotions screen. Tasks that can be promoted show as small cards (10 at a time, then "Show more"),
// and a tap on one opens the budget step. The list of promotable tasks is answered by the test, so paging is exact.

test.use({ storageState: ASHA.state });

const TOTAL = 25;
const shot = (page: Page, name: string) => (process.env.PROMO_SHOTS ? page.screenshot({ path: `${process.env.PROMO_SHOTS}/${name}.png` }) : Promise.resolve());

function fakePage(offset: number, limit: number) {
  const items = Array.from({ length: Math.min(limit, TOTAL - offset) }, (_, i) => {
    const n = offset + i + 1;
    const crew = n === 1;
    return {
      id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      title: `Promote me ${n}`,
      category: "cleaning",
      kind: "request",
      benchmark_minor: 50000 + n * 100,
      status: "OPEN",
      quotes: 0,
      crew_id: crew ? "11111111-1111-4111-8111-111111111111" : null,
      filled: crew ? 1 : 0,
      wanted: crew ? 5 : 1,
    };
  });
  return { items, hasMore: offset + limit < TOTAL };
}

async function mockPromotable(page: Page, calls: { offset: number; limit: number }[], empty = false) {
  await page.route("**/functions/v1/api", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = JSON.parse(route.request().postData() || "{}") as { op?: string; args?: { offset?: number; limit?: number } };
    if (body.op !== "promotableTasksPage") return route.fallback();
    const offset = body.args?.offset ?? 0;
    const limit = body.args?.limit ?? 10;
    calls.push({ offset, limit });
    const data = empty ? { items: [], hasMore: false } : fakePage(offset, limit);
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ ok: true, data }) });
  });
}

async function openPromotions(page: Page) {
  await page.goto("/");
  await expectSignedIn(page);
  await page.getByRole("button", { name: "Profile" }).first().click();
  await expect(page.getByRole("button", { name: "Promote a request" })).toHaveCount(0);
  await page.getByRole("button", { name: /^Promotions/ }).first().click();
  await expect(page.getByText("PROMOTE A TASK")).toBeVisible();
}

test("one Promotions screen: pick a task from small cards, 10 at a time", async ({ page }) => {
  const calls: { offset: number; limit: number }[] = [];
  await mockPromotable(page, calls);
  await openPromotions(page);
  await expect(page.getByText("YOUR PROMOTIONS")).toBeVisible();
  const cards = page.getByRole("button", { name: /^Promote Promote me/ });
  await expect(cards).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Promote Promote me 1, 1 of 5 workers" })).toBeVisible();
  await expect(page.getByText("No worker yet").first()).toBeVisible();
  await shot(page, "after-picker");
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(cards).toHaveCount(20);
  await page.getByRole("button", { name: "Show more" }).click();
  await expect(cards).toHaveCount(25);
  await expect(page.getByRole("button", { name: "Show more" })).toHaveCount(0);
  expect(calls.map((c) => c.offset)).toEqual([0, 10, 20]);
  // Choosing one opens the budget step with no typing.
  await cards.nth(1).click();
  await expect(page.getByText("SPEND UP TO, PER DAY")).toBeVisible();
  await expect(page.getByText("Promote me 2").first()).toBeVisible();
  await shot(page, "after-step");
});

test("nothing to promote says so and offers to post a task", async ({ page }) => {
  await mockPromotable(page, [], true);
  await openPromotions(page);
  await expect(page.getByText("Nothing to promote right now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Post a task" })).toBeVisible();
  await shot(page, "after-empty");
});
