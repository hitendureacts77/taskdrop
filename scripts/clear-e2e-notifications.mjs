/**
 * Removes the alerts that end-to-end test tasks leave behind ("[e2e] ..." tasks), for every account: the
 * customer, the worker and the staff. The tests can only use the app's own API, which can mark an alert
 * read but not delete it, so without this the bell keeps listing fake "[e2e]" tasks.
 *
 *   npm run e2e:clear-notifications     (also runs by itself after every Playwright run, via e2e/global-teardown.ts)
 *
 * Needs DATABASE_URL. Without it the script says so and stops without an error, so a test run on a machine
 * that has no database access is not failed by it. Only the test project and localhost are accepted
 * (scripts/lib/db.mjs), and only alerts whose title or text names an "[e2e" task are deleted.
 */
import { describeTarget, withDb } from "./lib/db.mjs";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DATABASE_URL is not set, so the \"[e2e]\" alerts were not removed. Run `npm run e2e:clear-notifications` with it set.");
  process.exit(0);
}

const deleted = await withDb(url, async (db) => {
  const res = await db.query(
    "delete from public.notifications where title like '%[e2e%' or coalesce(body, '') like '%[e2e%'",
  );
  return res.rowCount ?? 0;
});
console.log(`Removed ${deleted} \"[e2e]\" alert(s) from ${describeTarget(url)}.`);
