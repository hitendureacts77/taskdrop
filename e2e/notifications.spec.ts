import { expect, test } from "@playwright/test";
import { ASHA, RAVI, accessToken, apiAs, must } from "./helpers";

/**
 * Phase 5: the website has no push, so the bell must update on its own (a realtime ping), without a
 * refresh. Asha has the app open; Ravi, through the same door the app uses, quotes on her new task; her
 * bell must count one more while her page is left alone.
 */

test("the bell on an open page counts a new notification without a refresh (Phase 5)", async ({ browser, playwright }) => {
  const request = await playwright.request.newContext();

  const ashaContext = await browser.newContext({ storageState: ASHA.state });
  const raviContext = await browser.newContext({ storageState: RAVI.state });
  try {
    const ashaPage = await ashaContext.newPage();
    await ashaPage.goto("/");
    await expect(ashaPage.getByText("Wallet").first()).toBeVisible();
    // The bell counts one side at a time and a quote is for the poster, so be in Hire mode.
    await ashaPage.getByText("Hire", { exact: true }).first().click();
    const asha = apiAs(request, await accessToken(ashaPage));

    const ravi = await (async () => {
      const page = await raviContext.newPage();
      await page.goto("/");
      return apiAs(request, await accessToken(page));
    })();

    // Her bell, read from the page: its label is "Notifications" or "Notifications, 3 unread".
    const count = () =>
      ashaPage.evaluate(() => {
        const labels = [...document.querySelectorAll('[aria-label^="Notifications"]')].map((e) => e.getAttribute("aria-label") ?? "");
        return Math.max(0, ...labels.map((l) => Number(l.match(/(\d+) unread/)?.[1] ?? 0)));
      });
    const before = await count();

    const task = must(
      await asha<{ id: string }>("createTask", {
        pillar: "services",
        title: "[e2e] bell test",
        description: "End-to-end test task for the notification bell. Safe to ignore.",
        benchmarkMinor: 20000,
        timeLimitMinutes: 60,
        kind: "request",
        assignmentMode: "bids",
      }),
      "createTask",
    );
    must(
      await ravi("placeBid", { taskId: task.id, priceMinor: 20000, timeLimitMinutes: 60, message: "I can do this today." }),
      "placeBid",
    );

    // No reload: the realtime ping must move the bell on its own.
    await expect.poll(count, { timeout: 30_000, intervals: [1000] }).toBeGreaterThan(before);

    must(await asha("cancelTask", { taskId: task.id }), "cancelTask");
  } finally {
    await ashaContext.close();
    await raviContext.close();
  }
});
