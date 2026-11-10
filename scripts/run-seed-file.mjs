#!/usr/bin/env node
/**
 * Runs one SQL file from supabase/seed on the STAGING project (or localhost), e.g.
 *
 *   node scripts/run-seed-file.mjs supabase/seed/fake_world.sql
 *   node scripts/run-seed-file.mjs supabase/seed/fake_world_remove.sql
 *
 * DATABASE_URL comes from the environment, else `.env`, else `.env.all-secrets` (the plain
 * DATABASE_URL line, which is staging). It is never printed. lib/db.mjs refuses any target that is
 * not the test project or localhost, so production cannot be hit by mistake.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeTarget, withDb } from "./lib/db.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2];
if (!file || !/^supabase[\\/]seed[\\/][\w.-]+\.sql$/.test(file)) {
  console.error("Usage: node scripts/run-seed-file.mjs supabase/seed/<file>.sql");
  process.exit(2);
}

function fromFile(name) {
  try {
    const line = readFileSync(join(root, name), "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
    return line?.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "") ?? "";
  } catch {
    return "";
  }
}
const url = process.env.DATABASE_URL || fromFile(".env") || fromFile(".env.all-secrets");
if (!url) {
  console.error("No DATABASE_URL found.");
  process.exit(2);
}

const sql = readFileSync(join(root, file), "utf8");
console.log(`Running ${file} (${Math.round(sql.length / 1024)} KB) on ${describeTarget(url)} ...`);
await withDb(url, async (db) => {
  await db.query(sql);
});
console.log("Done.");
