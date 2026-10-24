#!/usr/bin/env node
/**
 * Copies the Edge Function secrets that Vercel already holds to the Supabase project, so the owner
 * keeps one place to edit them (Vercel) and no Supabase CLI login is needed on a PC.
 *
 * Run by scripts/vercel-build.mjs for Preview builds of `redesigned-2.0`, before the functions are
 * deployed. Only the names in SYNCED are ever sent, and only when Vercel holds a non-empty value:
 * a name that is missing is skipped and listed, never blanked. Razorpay keys are not here (they live
 * in Supabase Vault, supabase/functions/_shared/secrets.ts) and nothing starting with SUPABASE_ can
 * be set as a function secret anyway.
 *
 * Values go to the Supabase CLI through a private temporary --env-file that is deleted straight
 * after, never as command-line arguments, and only names are printed.
 *
 *   node scripts/sync-function-secrets.mjs --dry-run   list what would be sent (names only)
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** What the Edge Functions read with Deno.env (docs/INNGEST.md, docs/MEDIA.md, _shared/monitoring.ts). */
export const SYNCED = [
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "IMAGEKIT_PUBLIC_KEY",
  "IMAGEKIT_PRIVATE_KEY",
  "IMAGEKIT_URL_ENDPOINT",
  "IMAGEKIT_ENV",
  "SENTRY_DSN",
  "SENTRY_ENVIRONMENT",
  "GOOGLE_MAPS_API_KEY",
  "FIREBASE_PROJECT_NUMBER",
];

/** Splits the allow-list into what is present in `env` and what is missing or blank. */
export function pick(env) {
  const send = {};
  const missing = [];
  for (const name of SYNCED) {
    const value = (env[name] ?? "").trim();
    if (value && !/[\r\n]/.test(value)) send[name] = value;
    else missing.push(name);
  }
  return { send, missing };
}

/** The --env-file text: NAME="value" per line, quoted so a # or a space in a value is not read as a comment or a split. */
const quote = (v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
export const envFileText = (send) => Object.entries(send).map(([k, v]) => `${k}=${quote(v)}`).join("\n") + "\n";

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const project = process.env.SUPABASE_PROJECT_ID || "wjxvingpfbfvkfqhrguj";
  const { send, missing } = pick(process.env);
  const names = Object.keys(send);

  console.log(`[function-secrets] ${names.length ? `sending: ${names.join(", ")}` : "nothing to send"}`);
  if (missing.length) console.log(`[function-secrets] not set in Vercel, left as they are in Supabase: ${missing.join(", ")}`);
  if (dryRun || !names.length) return 0;

  const dir = mkdtempSync(join(tmpdir(), "taskdrop-secrets-"));
  const file = join(dir, "functions.env");
  try {
    writeFileSync(file, envFileText(send), { mode: 0o600 });
    const r = spawnSync("npx", ["--yes", "supabase@2", "secrets", "set", "--env-file", file, "--project-ref", project], {
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
      shell: process.platform === "win32",
    });
    // The CLI may echo names; never echo anything that could carry a value.
    if (r.status !== 0) {
      console.error(`[function-secrets] supabase secrets set failed (exit ${r.status}).`);
      return 1;
    }
    console.log(`[function-secrets] set ${names.length} secret${names.length === 1 ? "" : "s"} on ${project}`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exit(main());
