import { test as setup } from "@playwright/test";
import { ASHA, RAVI, signInWithPhone, waitForBackend } from "./helpers";

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
