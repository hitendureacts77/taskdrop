/**
 * Reads production's platform settings from the Supabase Management API (plan task 5.9): secret NAMES (Supabase
 * returns a digest, never the value, and this keeps only the name), each function's login check, and the sign-in
 * settings. Used by scripts/production-first-day.mjs and scripts/production-alarm.mjs; judged in ./prod-safety.mjs.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_PROJECT } from "./db.mjs";
import { expectedVerifyJwt } from "./prod-safety.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** The function folders in supabase/functions (everything but _shared and other `_` folders). */
export function functionSlugs(dir = join(root, "supabase/functions")) {
  return readdirSync(dir)
    .filter((d) => !d.startsWith("_") && !d.startsWith(".") && statSync(join(dir, d)).isDirectory())
    .sort();
}

/** What the code says each function's login check must be. */
export const expectedJwtFromRepo = () => expectedVerifyJwt(readFileSync(join(root, "supabase/config.toml"), "utf8"), functionSlugs());

async function getJson(path, token) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PRODUCTION_PROJECT}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Management API ${path} answered HTTP ${res.status}`);
  return res.json();
}

/** Null without a token. Only the fields the checks need are kept; secret digests are dropped straight away. */
export async function readPlatform(token) {
  if (!token) return null;
  const [secrets, functions, auth] = await Promise.all([getJson("/secrets", token), getJson("/functions", token), getJson("/config/auth", token)]);
  const pickAuth = ["hook_before_user_created_enabled", "hook_before_user_created_uri", "external_anonymous_users_enabled", "external_phone_enabled"];
  return {
    secretNames: (Array.isArray(secrets) ? secrets : []).map((s) => String(s?.name ?? "")).filter(Boolean),
    functions: (Array.isArray(functions) ? functions : []).map((f) => ({ slug: f?.slug, verify_jwt: f?.verify_jwt })),
    auth: auth && typeof auth === "object" ? Object.fromEntries(pickAuth.filter((k) => k in auth).map((k) => [k, auth[k]])) : null,
  };
}

/** Prints findings, one line each, as GitHub annotations. Never a value. */
export function printFindings(findings) {
  if (!findings.length) console.log("ok  - all clear");
  for (const f of findings) console.log(`${f.level === "critical" ? "::error::" : "::warning::"}${f.code}: ${f.what}`);
}
