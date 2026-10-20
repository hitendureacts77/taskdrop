#!/usr/bin/env node
/**
 * One command that resets the test data: deletes the four fake accounts in
 * supabase/seed/test_data.sql (and everything they own) and builds them again.
 *
 *   npm run seed:reset      the shared cloud test project, after you type "reset"
 *   npm run test:seed       a local or CI database only; runs the seed twice and checks the result
 *
 * Needs DATABASE_URL: the test project's connection string (Supabase dashboard -> Connect ->
 * Session pooler). Read it from the environment or from the git-ignored `.env` in this folder;
 * it is never printed.
 *
 * Guard rails (ground rule 8 in docs/UPGRADE_PLAN.md):
 *   - Only the test project (`wjxvingpfbfvkfqhrguj`) or localhost is accepted. Anything else,
 *     production included, is refused whatever flags are passed.
 *   - The cloud project also changes what the old app's testers see, so it always asks first.
 *   - Only the four seed accounts are touched; nobody else's data is deleted.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { describeTarget, TEST_PROJECT, targetKind, withDb } from "./lib/db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const local = process.argv.includes("--local");

/** DATABASE_URL from the environment, else from the `.env` file; the rest of that file is not read. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    const line = readFileSync(join(root, ".env"), "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
    return line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") ?? "";
  } catch {
    return "";
  }
}

const url = databaseUrl();
if (!url) {
  console.error("Set DATABASE_URL to the test project's connection string (see the top of this file).");
  process.exit(2);
}
const host = new URL(url).hostname;
const kind = targetKind(url); // "local", "test" (exact Supabase host/user for the test project) or null
const isLocal = kind === "local";

if (local && !isLocal) {
  console.error(`--local only runs on localhost; this URL points at ${host}. Nothing was changed.`);
  process.exit(1);
}
if (!kind) {
  console.error(`Refusing: ${host} is not the test project (${TEST_PROJECT}) or localhost. Nothing was changed.`);
  process.exit(1);
}

if (!isLocal) {
  console.log(`This resets the fake accounts and tasks on the shared test project (${describeTarget(url)}).`);
  console.log("The old app and old admin share this database, so its testers will see the data change.");
  console.log("Only the four seed accounts (phones 9990000001-3 and Test Admin) are deleted and rebuilt.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question('Type "reset" to continue: ')).trim();
  rl.close();
  if (answer !== "reset") {
    console.log("Cancelled. Nothing was changed.");
    process.exit(1);
  }
}

const seed = readFileSync(join(root, "supabase/seed/test_data.sql"), "utf8");
await withDb(url, async (c) => {
  await c.query(seed);
  await c.query(seed); // running it again must give the same result: it is a reset, not an append
  const { rows } = await c.query(`
    select (select count(*) from public.tasks where poster_id::text like '5eed0000%')::int as tasks,
           (select count(distinct status) from public.tasks where poster_id::text like '5eed0000%')::int as statuses,
           (select count(*) from auth.users where id::text like '5eed0000%')::int as users,
           (select count(*) from public.wallets where user_id::text like '5eed0000%' and (balance_minor + credits_minor) > 0)::int as funded_wallets`);
  const r = rows[0];
  if (r.tasks !== 12 || r.statuses !== 10 || r.users !== 4 || r.funded_wallets !== 3) {
    throw new Error(`The seed did not produce what it should: ${JSON.stringify(r)}`);
  }
  console.log(`ok  - ${r.users} accounts, ${r.tasks} tasks in ${r.statuses} statuses, ${r.funded_wallets} funded wallets`);
});
