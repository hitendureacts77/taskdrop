#!/usr/bin/env node
/**
 * Compatibility check, database side: does the database still hold everything the OLD
 * app's server code reads and calls?
 *
 * Reads the Edge Functions and app code of `main` (the old app, see scripts/lib/old-app.mjs),
 * collects every table in `.from("...")` and every function in `.rpc("...", { args })`,
 * and asks the database whether they still exist and still accept those argument names.
 * A migration that drops or renames one of them fails here, before the old app finds out.
 *
 *   DATABASE_URL=postgresql://... node scripts/check-old-app-db.mjs     (runs the query)
 *   node scripts/check-old-app-db.mjs --print-sql                      (prints the query, runs nothing)
 *
 * CI runs it against the throwaway database after every migration has been applied.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describeTarget, withDb } from "./lib/db.mjs";
import { oldAppDir } from "./lib/old-app.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const old = oldAppDir(repo);

const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
  }
};
walk(join(old, "supabase/functions"));
walk(join(old, "apps/mobile/src"));

const tables = new Set();
const rpcs = new Map(); // function name -> argument names the old code passes
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\.from\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*\)/g)) tables.add(m[1]);
  for (const m of src.matchAll(/\.rpc\(\s*["'`]([a-z_][a-z0-9_]*)["'`]\s*(?:,\s*\{([^}]*)\})?/g)) {
    const args = rpcs.get(m[1]) ?? new Set();
    rpcs.set(m[1], args);
    for (const k of (m[2] ?? "").matchAll(/(?:^|,)\s*([a-z_][a-z0-9_]*)\s*(?::|(?=,|$))/gi)) args.add(k[1]);
  }
}

const lit = (s) => `'${s}'`; // names matched above are [a-z0-9_] only, so this cannot break out of the quotes
const sql = `
with want_tables(name) as (values ${[...tables].map((t) => `(${lit(t)})`).join(",") || "(null)"}),
want_rpc(name, arg) as (values ${[...rpcs].flatMap(([n, args]) => (args.size ? [...args].map((a) => `(${lit(n)},${lit(a)})`) : [`(${lit(n)},null)`])).join(",") || "(null,null)"})
select 'missing table: ' || t.name from want_tables t
  where t.name is not null and not exists (
    select 1 from information_schema.tables x where x.table_schema = 'public' and x.table_name = t.name)
union all
select 'missing function: ' || r.name from (select distinct name from want_rpc where name is not null) r
  where not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = r.name)
union all
select 'function ' || r.name || ' no longer takes the argument ' || r.arg from want_rpc r
  where r.arg is not null
    and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = r.name)
    and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = r.name and r.arg = any (p.proargnames))
`;

if (process.argv.includes("--print-sql")) {
  console.log(sql);
  process.exit(0);
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL (or pass --print-sql).");
  process.exit(2);
}
console.log(`old app uses ${tables.size} tables and ${rpcs.size} functions; checking ${describeTarget(url)}`);
const out = (await withDb(url, (c) => c.query(sql))).rows.map((r) => Object.values(r)[0]);
if (out.length) {
  console.error(`The database would break the old app:\n${out.map((l) => "  " + l).join("\n")}`);
  process.exit(1);
}
console.log("ok  - everything the old app reads and calls is still in the database");
