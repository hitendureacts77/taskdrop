#!/usr/bin/env node
/**
 * Sets the Edge Function secrets straight in Supabase from the master file `.env.all-secrets`
 * (plan task 2.17, "one home per secret"). Nothing goes through Vercel any more.
 *
 * Why: Supabase never shows a secret again after it is saved, so the master file is the only place a
 * value can be read back. This script is the one way the file's values reach the function secrets.
 *
 *   node scripts/set-function-secrets.mjs --dry-run          names that would be sent (no network)
 *   node scripts/set-function-secrets.mjs --list-names       names Supabase holds vs the allow-list
 *   node scripts/set-function-secrets.mjs --only-missing     send only names Supabase does not hold yet
 *   node scripts/set-function-secrets.mjs                    send every allow-listed name the file has
 *   node scripts/set-function-secrets.mjs --production ...   production: reads PROD_<NAME>, targets the
 *                                                            project in PROD_SUPABASE_PROJECT_ID
 *
 * Rules the code enforces:
 *   - Only names on the allow-list are ever read from the file. LOGIN_, RECOVERY_, KEYSTORE_ names and
 *     anything starting with SUPABASE_ can never be sent (Supabase refuses SUPABASE_ names anyway).
 *   - Staging reads plain names and always targets the staging project. It never reads a PROD_ name.
 *   - Production reads only PROD_<NAME> and refuses to run against the staging project.
 *   - Staging-only names (ALLOW_ANY_OTP, TEST_PHONES) are never sent to production.
 *   - A name missing or blank in the file is skipped and listed, never blanked in Supabase.
 *   - Values go to the Supabase CLI through a private temporary --env-file that is deleted straight
 *     after, never as command-line arguments. Only names are printed, never a value.
 *
 * Razorpay / RazorpayX and API_GATEWAY_SECRET are not here: they live in Supabase Vault or in a
 * function secret already (supabase/functions/_shared/secrets.ts reads the secret first, then Vault),
 * and putting them in both would make two homes. scripts/push-payment-secrets.sh handles those.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const STAGING_PROJECT = "wjxvingpfbfvkfqhrguj";

/** Names every environment gets (what the Edge Functions read with Deno.env or secret()). */
const COMMON = [
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "INNGEST_MONEY_JOBS", // "on" lets Inngest run the three money sweeps; not a secret
  "INNGEST_PUSH_RECEIPT_WAIT", // a setting, not a secret
  "IMAGEKIT_PUBLIC_KEY",
  "IMAGEKIT_PRIVATE_KEY",
  "IMAGEKIT_URL_ENDPOINT",
  "IMAGEKIT_ENV",
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "GOOGLE_MAPS_API_KEY",
  "FIREBASE_PROJECT_NUMBER",
  "ALLOWED_ORIGINS", // browser origins the functions answer; differs per environment
];
/** Test shortcuts: staging only, never on production. */
export const STAGING_ONLY = ["ALLOW_ANY_OTP", "TEST_PHONES"];
/** Real SMS: production only (plan S.6 and 6.1; the key is never put in staging). */
export const PRODUCTION_ONLY = ["MSG91_AUTHKEY", "MSG91_TEMPLATE_ID"];

export const allowList = (production) => [...COMMON, ...(production ? PRODUCTION_ONLY : STAGING_ONLY)];

const FORBIDDEN_PREFIX = /^(SUPABASE_|LOGIN_|RECOVERY_|KEYSTORE_|PROD_)/;
/** A name that may never be sent as a function secret, whatever the lists say. */
export const isForbiddenName = (name) => FORBIDDEN_PREFIX.test(name);

/** Parses `NAME=value` lines (quotes optional, `export ` and `#` comments allowed). Values are never logged. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    const q = value[0];
    if ((q === '"' || q === "'") && value.length >= 2 && value.endsWith(q)) value = value.slice(1, -1);
    out[m[1]] = value;
  }
  return out;
}

/**
 * Splits the allow-list into what the file holds and what is missing or blank.
 * `file` is the parsed master file. Staging reads plain names; production reads PROD_<NAME>.
 * Names in `skip` (already in Supabase, for --only-missing) are neither sent nor reported missing.
 */
export function pick(file, { production = false, skip = [] } = {}) {
  const send = {};
  const missing = [];
  const skipped = [];
  for (const name of allowList(production)) {
    if (isForbiddenName(name)) throw new Error(`refusing to handle ${name}`);
    if (skip.includes(name)) {
      skipped.push(name);
      continue;
    }
    const value = (file[production ? `PROD_${name}` : name] ?? "").trim();
    if (value && !/[\r\n]/.test(value)) send[name] = value;
    else missing.push(name);
  }
  return { send, missing, skipped };
}

/** Which project to talk to. Staging is fixed; production must come from the file and differ from staging. */
export function resolveProject(file, production) {
  if (!production) return { ok: true, ref: STAGING_PROJECT };
  const ref = (file.PROD_SUPABASE_PROJECT_ID ?? "").trim();
  if (!ref) return { ok: false, why: "PROD_SUPABASE_PROJECT_ID is not in the secrets file (the production project does not exist yet; Step 5)." };
  if (!/^[a-z0-9]{20}$/.test(ref)) return { ok: false, why: "PROD_SUPABASE_PROJECT_ID is not a Supabase project ref (20 lowercase letters and digits)." };
  if (ref === STAGING_PROJECT) return { ok: false, why: "PROD_SUPABASE_PROJECT_ID is the staging project. Production and staging must stay separate." };
  return { ok: true, ref };
}

/** The --env-file text: NAME="value" per line, quoted so a # or a space in a value is not read as a comment or a split. */
const quote = (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export const envFileText = (send) => Object.entries(send).map(([k, v]) => `${k}=${quote(v)}`).join("\n") + "\n";

/** Pulls secret names out of `supabase secrets list` output (JSON, or the table as a fallback). Digests are dropped. */
export function parseNames(stdout) {
  try {
    const data = JSON.parse(stdout);
    if (Array.isArray(data)) return data.map((r) => String(r?.name ?? r?.Name ?? "")).filter(Boolean);
  } catch {
    // not JSON: read the table
  }
  return stdout
    .split(/\r?\n/)
    .map((l) => /^\s*\|?\s*([A-Z][A-Z0-9_]+)\s*\|/.exec(l)?.[1])
    .filter((n) => n && n !== "NAME");
}

function findSecretsFile(explicit) {
  const candidates = [];
  if (explicit) candidates.push(resolve(explicit));
  if (process.env.SECRETS_FILE) candidates.push(resolve(process.env.SECRETS_FILE));
  candidates.push(resolve(".env.all-secrets"));
  // A git worktree has no copy of the git-ignored file; the main checkout does.
  const g = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8" });
  if (g.status === 0) candidates.push(join(dirname(g.stdout.trim()), ".env.all-secrets"));
  return candidates.find((p) => existsSync(p));
}

const cli = (args, env) =>
  spawnSync("npx", ["--yes", "supabase@2", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });

function main() {
  const argv = process.argv.slice(2);
  const has = (f) => argv.includes(f);
  const production = has("--production");
  const dryRun = has("--dry-run");
  const listOnly = has("--list-names");
  const onlyMissing = has("--only-missing");
  const fileArg = argv.includes("--file") ? argv[argv.indexOf("--file") + 1] : undefined;

  const path = findSecretsFile(fileArg);
  if (!path) {
    console.error("[set-function-secrets] .env.all-secrets not found (use --file or SECRETS_FILE).");
    return 1;
  }
  const file = parseEnv(readFileSync(path, "utf8"));
  const project = resolveProject(file, production);
  if (!project.ok) {
    console.error(`[set-function-secrets] ${project.why}`);
    return 1;
  }
  const label = production ? "production" : "staging";
  const tokenName = production ? "PROD_SUPABASE_ACCESS_TOKEN" : "SUPABASE_ACCESS_TOKEN";
  const env = file[tokenName] ? { SUPABASE_ACCESS_TOKEN: file[tokenName] } : {};
  console.log(`[set-function-secrets] target: ${label} project ${project.ref}`);

  let held = null; // names Supabase holds, when we asked
  if (listOnly || (onlyMissing && !dryRun)) {
    const r = cli(["secrets", "list", "--project-ref", project.ref, "-o", "json"], env);
    if (r.status !== 0) {
      console.error(`[set-function-secrets] supabase secrets list failed (exit ${r.status}).`);
      return 1;
    }
    held = parseNames(r.stdout);
  }

  if (listOnly) {
    const wanted = allowList(production);
    const have = wanted.filter((n) => held.includes(n));
    const lack = wanted.filter((n) => !held.includes(n));
    const inFile = lack.filter((n) => (file[production ? `PROD_${n}` : n] ?? "").trim());
    console.log(`[set-function-secrets] in Supabase (${have.length}): ${have.join(", ") || "none"}`);
    console.log(`[set-function-secrets] not in Supabase (${lack.length}): ${lack.join(", ") || "none"}`);
    if (inFile.length) console.log(`[set-function-secrets] ...of those, the file has: ${inFile.join(", ")}`);
    return 0;
  }

  const { send, missing, skipped } = pick(file, { production, skip: onlyMissing && held ? held : [] });
  const names = Object.keys(send);
  console.log(`[set-function-secrets] ${names.length ? `sending: ${names.join(", ")}` : "nothing to send"}`);
  if (skipped.length) console.log(`[set-function-secrets] already in Supabase, left as they are: ${skipped.join(", ")}`);
  if (missing.length) console.log(`[set-function-secrets] not in the file (or blank), left as they are in Supabase: ${missing.join(", ")}`);
  if (dryRun || !names.length) return 0;

  const dir = mkdtempSync(join(tmpdir(), "taskdrop-secrets-"));
  const envFile = join(dir, "functions.env");
  try {
    writeFileSync(envFile, envFileText(send), { mode: 0o600 });
    const r = cli(["secrets", "set", "--env-file", envFile, "--project-ref", project.ref], env);
    // The CLI may echo names; never echo anything that could carry a value.
    if (r.status !== 0) {
      console.error(`[set-function-secrets] supabase secrets set failed (exit ${r.status}).`);
      return 1;
    }
    console.log(`[set-function-secrets] set ${names.length} secret${names.length === 1 ? "" : "s"} on ${project.ref}`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
