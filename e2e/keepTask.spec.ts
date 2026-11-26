import { test, expect, type Page } from "@playwright/test";
import { ASHA, accessToken, apiAs, expectSignedIn, must, tidyE2eTasks } from "./helpers";

/**
 * Delete a task (task 1.19 row A): the poster first sees "Give your task one more go?" with the ways to keep it
 * (Top up, Share, Post again), and only "Delete anyway" opens the final confirm. Posts its own "[e2e]" open task
 * for ₹500 (no money moves), keeps it once, then deletes it. The paid-task refund is covered in planB.spec.ts (d).
 */

type Call = ReturnType<typeof apiAs>;
type Mine = { id: string; status: string };

test.use({ storageState: ASHA.state });

let asha: Call | null = null;
// A run tag in letters: a long number in a title reads as a phone number to the contact filter.
const tag = () => Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6);

async function openDelete(page: Page, title: string) {
  await page.getByRole("button", { name: "Task options" }).first().click();
  await page.getByText("Delete task", { exact: true }).click();
  await expect(page.getByText("Give your task one more go?")).toBeVisible();
}

test.afterAll(async () => {
  if (asha) await tidyE2eTasks(asha).catch(() => 0);
});

test("deleting an open task offers ways to keep it, then deletes only after Delete anyway", async ({ page }) => {
  const title = `[e2e] keep it ${tag()}`;
  await page.goto("/");
  await expectSignedIn(page);
  const call = apiAs(page.request, await accessToken(page));
  asha = call;
  const task = must(
    await call<{ id: string }>("createTask", {
      pillar: "services",
      title,
      description: "End-to-end test task for the keep-it sheet. Safe to ignore; it is deleted when the test ends.",
      benchmarkMinor: 50_000,
      timeLimitMinutes: 60,
      kind: "request",
      assignmentMode: "bids",
    }),
    "createTask",
  );
  const status = async () => must(await call<Mine[]>("listMyTasks"), "listMyTasks").find((t) => t.id === task.id)?.status;

  // The saved sign-in may be in Earn mode (another test left it there), where the tab is "My Work".
  await page.getByText("Hire", { exact: true }).first().click();
  await page.getByText("My Tasks", { exact: true }).first().click();
  await page.getByPlaceholder("Search tasks, category…").fill(title);
  await expect(page.getByText(title).first()).toBeVisible();

  await openDelete(page, title);
  await expect(page.getByText("Top up the offer")).toBeVisible();
  // The first top-up step is admin-set (TOP_UP_PCTS), so only the shape of the line is checked.
  await expect(page.getByText(/^Workers see ₹[\d,]+\. You pay only when you accept an offer\.$/)).toBeVisible();
  await expect(page.getByText("Share the task")).toBeVisible();
  await expect(page.getByText("Post again with changes")).toBeVisible();
  if (process.env.KEEP_SHEET_SHOT) await page.screenshot({ path: process.env.KEEP_SHEET_SHOT });
  await page.getByText("Keep my task", { exact: true }).click();
  await expect(page.getByText("Give your task one more go?")).toBeHidden();
  expect(await status()).toBe("OPEN");

  await openDelete(page, title);
  await page.getByText("Delete anyway", { exact: true }).click();
  await expect(page.getByText("Delete this task?")).toBeVisible();
  await page.getByText("Yes, delete", { exact: true }).click();
  await expect.poll(status, { timeout: 15_000 }).toBe("CANCELLED");
});
