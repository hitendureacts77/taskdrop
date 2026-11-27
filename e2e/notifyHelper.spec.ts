import { test, expect } from "@playwright/test";
import { ASHA, accessToken, apiAs, expectSignedIn, must, tidyE2eTasks } from "./helpers";

/**
 * Notify a helper (task 1.21 row C, migration 231): "Book again" and the 10-minute "Offer to Ravi first" are gone.
 * My regulars shows "Notify about a task"; the sheet lists the poster's open tasks and "Post a new task", and says
 * the task stays open to everyone. The server sends one notice per helper per task. Uses Asha's regulars on the test
 * project and skips when she has none (a fresh database).
 */

type Call = ReturnType<typeof apiAs>;
type Regular = { profile: { id: string; display_name: string } };

test.use({ storageState: ASHA.state });

let asha: Call | null = null;
const tag = () => Math.random().toString(36).replace(/[^a-z]/g, "").slice(0, 6);

test.afterAll(async () => {
  if (asha) await tidyE2eTasks(asha).catch(() => 0);
});

test("My regulars notifies a helper about an open task, once, with no hold", async ({ page }) => {
  await page.goto("/");
  await expectSignedIn(page);
  const call = apiAs(page.request, await accessToken(page));
  asha = call;
  const regulars = must(await call<Regular[]>("myRegulars"), "myRegulars");
  test.skip(regulars.length === 0, "Asha has no regulars on this database");
  const helper = regulars[0]!.profile;

  const title = `[e2e] notify helper ${tag()}`;
  const task = must(
    await call<{ id: string; preferred_until?: string | null }>("createTask", {
      pillar: "services",
      title,
      description: "End-to-end test task for notifying a regular. Safe to ignore; it is deleted when the test ends.",
      benchmarkMinor: 50_000,
      timeLimitMinutes: 60,
      kind: "request",
      assignmentMode: "bids",
    }),
    "createTask",
  );

  await page.getByText("Hire", { exact: true }).first().click();
  await page.getByText("Profile", { exact: true }).first().click();
  await page.getByText("My regulars", { exact: true }).first().click();
  await expect(page.getByText("People you liked working with, one tap away").first()).toBeVisible();
  await expect(page.getByText("Book again")).toHaveCount(0);
  await expect(page.getByText(/first 10 minutes/)).toHaveCount(0);
  await page.getByRole("button", { name: `Notify ${helper.display_name} about a task` }).first().click();
  await expect(page.getByText(/gets a notification with the link\. Your task stays open to everyone\./).first()).toBeVisible();
  await expect(page.getByText("Post a new task")).toBeVisible();
  await page.getByText(title).first().click();
  await expect(page.getByText(/was notified\. Your task stays open to everyone|was already told about this task/).first()).toBeVisible();

  // Once per helper per task: a second try sends nothing.
  const again = must(await call<{ sent: boolean; already: boolean }>("notifyHelperAboutTask", { taskId: task.id, workerId: helper.id }), "notifyHelperAboutTask");
  expect(again.already).toBe(true);
});
