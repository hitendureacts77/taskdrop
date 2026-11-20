import { test, expect, type Page } from "@playwright/test";
import { ASHA, accessToken, apiAs, expectSignedIn, must, tidyE2eTasks } from "./helpers";

/**
 * Top up on an open post (D31, PR 447, migration 194): the poster raises what workers see from My tasks.
 * At phone size the open-post card has its own "Top up" button; on a desktop the table row's menu has it.
 * Each test posts its own "[e2e]" task for ₹500 (offers, no money moves), tops it up 10% to ₹550 through the
 * screen, and reads the task back from the server. afterAll closes the tasks again.
 */

type Call = ReturnType<typeof apiAs>;
type Mine = { id: string; title: string; topup_pct: number; benchmark_minor: number };

test.use({ storageState: ASHA.state });
test.describe.configure({ mode: "serial" });

let asha: Call | null = null;
// A run tag in letters: a long number in a title reads as a phone number to the contact filter.
const tag = () => Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6);

async function postOpenTask(page: Page, title: string): Promise<{ call: Call; id: string }> {
  await page.goto("/");
  await expectSignedIn(page);
  const call = apiAs(page.request, await accessToken(page));
  asha = call;
  const task = must(
    await call<{ id: string }>("createTask", {
      pillar: "services",
      title,
      description: "End-to-end test task for Top up. Safe to ignore; it is closed when the test ends.",
      benchmarkMinor: 50_000,
      timeLimitMinutes: 60,
      kind: "request",
      assignmentMode: "bids",
    }),
    "createTask",
  );
  return { call, id: task.id };
}

async function openMyTasks(page: Page, title: string) {
  // The saved sign-in may be in Earn mode (another test left it there), where the tab is "My Work".
  await page.getByText("Hire", { exact: true }).first().click();
  await page.getByText("My Tasks", { exact: true }).first().click();
  await page.getByPlaceholder("Search tasks, category…").fill(title);
}

async function pickTenPercent(page: Page) {
  await expect(page.getByText("Top up this task")).toBeVisible();
  await expect(page.getByText("Workers see ₹550").first()).toBeVisible();
  await page.getByText("Top up 10%", { exact: true }).click();
  await expect(page.getByText("Topped up 10%: workers now see ₹550")).toBeVisible();
}

async function expectRaised(call: Call, id: string) {
  const mine = must(await call<Mine[]>("listMyTasks"), "listMyTasks");
  const row = mine.find((t) => t.id === id);
  expect(row?.topup_pct).toBe(10);
  expect(row?.benchmark_minor).toBe(55_000);
}

test.afterAll(async () => {
  if (asha) await tidyE2eTasks(asha).catch(() => 0);
});

test.describe("phone size", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the open-post card's Top up button raises what workers see", async ({ page }) => {
    const title = `[e2e] top up card ${tag()}`;
    const { call, id } = await postOpenTask(page, title);
    await openMyTasks(page, title);
    await page.getByRole("button", { name: `Top up: ${title}` }).click();
    await pickTenPercent(page);
    await expectRaised(call, id);
  });
});

test("on a desktop the task menu's Top up raises what workers see", async ({ page }) => {
  const title = `[e2e] top up menu ${tag()}`;
  const { call, id } = await postOpenTask(page, title);
  await openMyTasks(page, title);
  await expect(page.getByText(title).first()).toBeVisible();
  await page.getByRole("button", { name: "Task options" }).first().click();
  await page.getByText("Top up", { exact: true }).click();
  await pickTenPercent(page);
  await expectRaised(call, id);
});
