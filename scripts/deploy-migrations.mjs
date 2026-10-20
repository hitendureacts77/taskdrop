#!/usr/bin/env node
/**
 * Applies the migrations the shared test project has not seen yet, in order.
 *
 * Why not `supabase db push`: the cloud project's migration history was written by hand
 * over several weeks, so it disagrees with supabase/migrations/ almost everywhere (checked
 * 2026-10-20: 95 migrations carry other version numbers, 11 history rows have no file,
 * 6 files have no row). `db push` would try to apply old files again. Rewriting about a
 * hundred history rows is possible but risky, and this gets the same result without
 * touching what is already recorded.
 *
 * A file is NEW, and gets applied, only when both hold:
 *   - no history row carries its number (the `101` of `101_inngest_background_jobs`), and
 *   - its version is later than the newest version in the history.
 * Everything older is treated as already applied. Each new file runs in one transaction and is
 * then recorded under its own version and name, so the next run skips it.
 *
 *   DATABASE_URL=postgresql://... node scripts/deploy-migrations.mjs            apply
 *   DATABASE_URL=postgresql://... node scripts/deploy-migrations.mjs --dry-run  only list
 *   MIGRATION_HISTORY_FILE=history.txt node scripts/deploy-migrations.mjs --dry-run
 *        (lines of "<version> <name>" instead of asking the database; for tests)
 *
 * Never runs against anything but the URL it is given: point it at the test project only.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeTarget, withDb } from "./lib/db.mjs";

const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "supabase/migrations");
const dryRun = process.argv.includes("--dry-run");
const url = process.env.DATABASE_URL;

async function readHistory() {
  if (process.env.MIGRATION_HISTORY_FILE) {
    return readFileSync(process.env.MIGRATION_HISTORY_FILE, "utf8").trim().split("\n").map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2);
  }
  if (!url) {
    console.error("Set DATABASE_URL (the test project's connection string), or MIGRATION_HISTORY_FILE with --dry-run.");
    process.exit(2);
  }
  const res = await withDb(url, (c) => c.query("select version, name from supabase_migrations.schema_migrations order by version"));
  return res.rows.map((r) => [r.version, r.name]);
}

/** `101_inngest_background_jobs` -> "101"; `051b_push_token` -> "051b"; names without a number -> null. */
const numberOf = (name) => /^(\d+[a-z]?)_/.exec(name)?.[1] ?? null;

export function pending(files, history) {
  const newest = history.reduce((m, [v]) => (v > m ? v : m), "0");
  const seen = new Set(history.map(([, name]) => numberOf(name)).filter(Boolean));
  return files
    .map((f) => {
      const m = /^(\d{14})_(.+)\.sql$/.exec(f);
      return m ? { file: f, version: m[1], name: m[2] } : null;
    })
    .filter((x) => x && x.version > newest && !seen.has(numberOf(x.name)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const todo = pending(readdirSync(dir).filter((f) => f.endsWith(".sql")).sort(), await readHistory());
  if (todo.length === 0) {
    console.log("ok  - the project already has every migration");
    process.exit(0);
  }
  console.log(`${todo.length} new migration(s) for ${url ? describeTarget(url) : "(history file)"}:\n${todo.map((m) => "  " + m.file).join("\n")}`);
  if (dryRun) process.exit(0);
  await withDb(url, async (c) => {
    for (const m of todo) {
      // One transaction per file: the file is applied and recorded together or not at all.
      await c.query("begin");
      try {
        await c.query(readFileSync(join(dir, m.file), "utf8"));
        await c.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2) on conflict (version) do nothing", [m.version, m.name]);
        await c.query("commit");
      } catch (e) {
        await c.query("rollback");
        throw new Error(`${m.file} failed and was rolled back: ${e.message}`);
      }
      console.log(`applied ${m.file}`);
    }
  });
}
