import { spawnSync } from "node:child_process";

/**
 * Runs after every Playwright run, passed or failed (an npm "post" script is skipped when tests fail):
 * removes the "[e2e]" alerts the tests left on the test accounts. Does nothing without DATABASE_URL.
 */
export default function globalTeardown(): void {
  spawnSync(process.execPath, ["scripts/clear-e2e-notifications.mjs"], { stdio: "inherit" });
}
