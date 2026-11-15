#!/usr/bin/env node
/**
 * Production's first-day safety, run after every approved production deploy (plan task 5.9; holes H1, H3, H15).
 *
 *   1. supabase/production/first_day.sql   test sign-in off, admin MFA on, environment production, GraphQL off, anon rights none
 *   2. supabase/lockdown/gateway_only.sql  the direct database door closed ("built already switched over", H3)
 *   3. checks, read back from the database: every item above, the database defaults, the Vault, the money settings
 *   4. checks from the Management API (with PROD_SUPABASE_ACCESS_TOKEN): no test-shortcut secret names, and each
 *      function's login setting matches supabase/config.toml (incl. razorpayx-webhook, H73), the sign-in settings
 *
 * Steps 1 and 2 run in ONE transaction: both or neither. A critical finding in 3 or 4 exits 1.
 *
 *   PRODUCTION_DEPLOY=1 PROD_SUPABASE_DB_PASSWORD=... node scripts/production-first-day.mjs [--dashboard-pending]
 *        production only (GitHub Actions, environment production-database). --dashboard-pending reports the sign-in
 *        settings the owner sets by hand (task 5.9 table) as warnings instead of failures.
 *        --database-only skips the Management API part (the deploy runs it before the functions exist).
 *        --strict is the default, named so the workflow can pass one flag or the other.
 *   DATABASE_URL=postgresql://...@127.0.0.1:54322/postgres node scripts/production-first-day.mjs --rehearse-local
 *        CI's throwaway database only: runs the same SQL and the database checks, so a broken statement fails in CI
 *        long before production. Refuses anything but localhost.
 *   node scripts/production-first-day.mjs --dry-run   prints the plan, connects to nothing
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeTarget, productionUrl, targetKind, withDb } from "./lib/db.mjs";
import { expectedJwtFromRepo, printFindings, readPlatform } from "./lib/prod-platform.mjs";
import { criticalOf, DB_STATE_SQL, dbStateParams, judgeDatabase, judgePlatform } from "./lib/prod-safety.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FILES = ["supabase/production/first_day.sql", "supabase/lockdown/gateway_only.sql"];
const args = process.argv.slice(2);
const rehearse = args.includes("--rehearse-local");
const dashboardPending = args.includes("--dashboard-pending");
const databaseOnly = args.includes("--database-only"); // straight after the migrations, before the functions exist

if (args.includes("--dry-run")) {
  console.log(`would run, in one transaction: ${FILES.join(", ")}`);
  console.log("then check the database state (prod-safety.mjs judgeDatabase) and, with a token, the platform (judgePlatform)");
  console.log(`functions and their login check from supabase/config.toml: ${JSON.stringify(expectedJwtFromRepo())}`);
  process.exit(0);
}

let url;
if (rehearse) {
  url = process.env.DATABASE_URL;
  if (!url || targetKind(url) !== "local") {
    console.error("--rehearse-local runs on localhost only (CI's throwaway database).");
    process.exit(1);
  }
} else {
  url = process.env.DATABASE_URL || productionUrl(process.env.PROD_SUPABASE_DB_PASSWORD, process.env.PROD_SUPABASE_POOLER_HOST);
}

console.log(`[first-day] target: ${describeTarget(url)}${rehearse ? " (rehearsal)" : ""}`);
const db = await withDb(
  url,
  async (c) => {
    await c.query("begin");
    try {
      for (const f of FILES) {
        await c.query(readFileSync(join(root, f), "utf8"));
        console.log(`[first-day] ran ${f}`);
      }
      await c.query("commit");
    } catch (e) {
      await c.query("rollback");
      throw new Error(`first-day SQL failed and was rolled back: ${e.message}`);
    }
    return (await c.query(DB_STATE_SQL, dbStateParams())).rows[0].state;
  },
  { production: rehearse ? false : "only" },
);

const findings = judgeDatabase(db);
if (!rehearse && !databaseOnly) {
  const platform = await readPlatform(process.env.PROD_SUPABASE_ACCESS_TOKEN);
  findings.push(...judgePlatform(platform, expectedJwtFromRepo(), { dashboardPending }));
}
printFindings(findings);
const bad = criticalOf(findings);
if (bad.length) {
  console.error(`[first-day] ${bad.length} critical finding(s). Production is NOT safe to open; fix them and run the workflow again.`);
  process.exit(1);
}
console.log("[first-day] production's first-day checks passed");
