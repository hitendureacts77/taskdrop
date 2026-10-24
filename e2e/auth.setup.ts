import { test as setup } from "@playwright/test";
import { ASHA, RAVI, accessToken, apiAs, signInWithPhone, tidyE2eTasks, waitForBackend } from "./helpers";

// A deploy may be under way: do not start into the gap.
setup("the backend answers its uptime check", async ({ playwright }) => {
  await waitForBackend(await playwright.request.newContext());
});

// Sign in once per seed account through the real screen and keep the session for the other tests.
for (const who of [ASHA, RAVI]) {
  setup(`sign in as ${who.label}`, async ({ page }) => {
    await signInWithPhone(page, who.phone);
    await page.context().storageState({ path: who.state });
  });
}

// What an earlier run (or a failed one) left half-way is finished now, so the admin's queues stay clean.
setup("tidy the jobs earlier runs left behind", async ({ browser, playwright }) => {
  const context = await browser.newContext({ storageState: ASHA.state });
  try {
    const page = await context.newPage();
    await page.goto("/");
    await tidyE2eTasks(apiAs(await playwright.request.newContext(), await accessToken(page)));
  } finally {
    await context.close();
  }
});
