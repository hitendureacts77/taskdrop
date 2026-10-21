import { test as setup } from "@playwright/test";
import { ASHA, RAVI, signInWithPhone } from "./helpers";

// Sign in once per seed account through the real screen and keep the session for the other tests.
for (const who of [ASHA, RAVI]) {
  setup(`sign in as ${who.label}`, async ({ page }) => {
    await signInWithPhone(page, who.phone);
    await page.context().storageState({ path: who.state });
  });
}
