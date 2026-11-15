#!/usr/bin/env node
/**
 * The outside safety alarm for production (plan task 5.9; holes H1, H3, H15, H21, H56, H73).
 * Run every hour by .github/workflows/production-alarm.yml. It only READS.
 *
 * It checks, without changing anything: dev_otp_for_all off, admin MFA on, environment 'production', no
 * ALLOW_ANY_OTP / TEST_PHONES / App Check debug token among the function secrets or in the Vault, no Razorpay test
 * key id in the Vault, GraphQL off, the direct door closed, anon table rights none, each function's login check as in
 * the code, and the sign-up guard hook on. Rules: scripts/lib/prod-safety.mjs.
 *
 * On any critical finding, or when production cannot be read at all, it sends ONE fatal event to the production
 * Sentry project (PROD_SENTRY_DSN), whose alert rule emails the owner, and exits 1 so the run shows red.
 * The Inngest job `safety-alarm` is the inside half (it can read function-secret values; this cannot).
 *
 *   PRODUCTION_DEPLOY=1 PROD_SUPABASE_DB_PASSWORD=... PROD_SENTRY_DSN=... [PROD_SUPABASE_ACCESS_TOKEN=...] \
 *     node scripts/production-alarm.mjs
 *   node scripts/production-alarm.mjs --dry-run      what it would check; connects to nothing
 */
import { describeTarget, productionUrl, withDb } from "./lib/db.mjs";
import { expectedJwtFromRepo, printFindings, readPlatform } from "./lib/prod-platform.mjs";
import { alarmLine, criticalOf, DB_STATE_SQL, dbStateParams, judgeDatabase, judgePlatform, parseDsn, sendToSentry } from "./lib/prod-safety.mjs";

if (process.argv.includes("--dry-run")) {
  console.log("would read production's database state and, with a token, its platform settings, then alarm on any critical finding");
  console.log(`functions and their login check from supabase/config.toml: ${JSON.stringify(expectedJwtFromRepo())}`);
  process.exit(0);
}

const dsn = process.env.PROD_SENTRY_DSN;
if (!parseDsn(dsn)) {
  // Without a working DSN the alarm cannot reach anyone; a red run is the only signal left.
  console.error("::error::PROD_SENTRY_DSN is missing or not a Sentry DSN; the alarm cannot email anyone.");
  process.exit(1);
}
const runUrl = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  : undefined;

let findings;
try {
  const url = productionUrl(process.env.PROD_SUPABASE_DB_PASSWORD, process.env.PROD_SUPABASE_POOLER_HOST);
  console.log(`[alarm] target: ${describeTarget(url)}`);
  const db = await withDb(url, async (c) => (await c.query(DB_STATE_SQL, dbStateParams())).rows[0].state, { production: "only" });
  findings = judgeDatabase(db);
  findings.push(...judgePlatform(await readPlatform(process.env.PROD_SUPABASE_ACCESS_TOKEN), expectedJwtFromRepo()));
} catch (e) {
  // Not being able to look is itself an alarm: a changed password or a paused project must not read as "all clear".
  findings = [{ level: "critical", code: "PRODUCTION_UNREADABLE", what: `The alarm could not read production (${String(e.message).slice(0, 200)}).` }];
}

printFindings(findings);
const bad = criticalOf(findings);
if (bad.length) {
  console.error(`[alarm] ${alarmLine(findings)}`);
  try {
    const id = await sendToSentry(dsn, findings, { runUrl });
    console.error(`[alarm] Sentry event ${id} sent`);
  } catch (e) {
    console.error(`::error::${e.message}`);
  }
  process.exit(1);
}
console.log("[alarm] all clear");
