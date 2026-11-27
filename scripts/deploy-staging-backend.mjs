#!/usr/bin/env node
/**
 * Puts the backend of `redesigned-2.0` on the shared test (staging) Supabase project.
 * Run by .github/workflows/deploy-staging.yml on every push to `redesigned-2.0`, BEFORE the staging
 * web app is built, so the web app never goes live against a half-updated backend (plan task 5.12).
 * Until 22 Nov 2026 this was the first half of scripts/vercel-build.mjs.
 *
 *   1. old-app contract         npm run test:contract         (needs `main`; see below)
 *   2. new migrations           scripts/deploy-migrations.mjs
 *   3. old-app database check   scripts/check-old-app-db.mjs  (needs `main`)
 *   4. Edge Functions           supabase functions deploy  (up to 3 attempts, for a one-off network or API hiccup)
 *   5. Inngest sync             warning only, until the Inngest Cloud keys are set
 *
 * Any failure in 1-4 exits non-zero, so the workflow stops and the web app is not published.
 * The production database is NOT touched here: it waits for the owner's Approve in
 * .github/workflows/production-database.yml.
 *
 * Needs (GitHub environment `staging-backend`; values come from .env.all-secrets):
 *   SUPABASE_ACCESS_TOKEN   deploys Edge Functions
 *   DATABASE_URL            the test project's Session pooler connection string
 *
 *   node scripts/deploy-staging-backend.mjs --dry-run   print what would run
 */
import { spawnSync } from "node:child_process";
import { missingOrShort } from "./lib/required-env.mjs";

const dryRun = process.argv.includes("--dry-run");
const projectId = process.env.SUPABASE_PROJECT_ID || "wjxvingpfbfvkfqhrguj";
const functionUrl = `https://${projectId}.supabase.co/functions/v1/inngest`;

const note = (m) => console.log(`[staging-backend] ${m}`);
const warn = (m) => console.log(`::warning:: [staging-backend] ${m}`);
const fail = (m) => {
  console.error(`::error:: [staging-backend] ${m}`);
  process.exit(1);
};

function run(label, cmd, args, env = {}) {
  note(`${label}: ${cmd} ${args.join(" ")}`);
  if (dryRun) return true;
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  return r.status === 0;
}
function must(label, cmd, args, env) {
  if (!run(label, cmd, args, env)) fail(`FAILED at "${label}". Nothing after it ran, so the web app is not published. Fix it and push again.`);
}
// Only for steps that are safe to repeat. If the last attempt fails it stops exactly as `must` does.
async function mustRetry(label, cmd, args, env, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    if (run(`${label} (attempt ${i}/${attempts})`, cmd, args, env)) return;
    if (i < attempts) {
      const waitSeconds = 10 * i;
      note(`"${label}" failed on attempt ${i}/${attempts}; waiting ${waitSeconds}s, then trying again.`);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
    }
  }
  fail(`FAILED at "${label}" after ${attempts} attempts. Nothing after it ran, so the web app is not published. Fix it and push again.`);
}

// Secrets the backend steps need, with the shortest length a real one has (a Supabase access token is 44 characters).
const REQUIRED = [
  { name: "SUPABASE_ACCESS_TOKEN", min: 40 },
  { name: "DATABASE_URL", min: 30 },
];

// Task 2.5: a missing or stub secret fails the deploy, so the web app is never published against a backend
// that was silently skipped. Names only are printed.
const missing = missingOrShort(process.env, REQUIRED);
if (missing.length > 0 && !dryRun) fail(`${missing.join("; ")}. Set them in GitHub -> Settings -> Environments -> staging-backend (docs/DEPLOY.md).`);

// `main` is the old app. Fetch it to compare against (the checkout is shallow and has only this branch).
let oldAppEnv = null;
if (dryRun) {
  note("fetch main: git fetch --depth=1 origin main");
  oldAppEnv = { OLD_APP_REF: "FETCH_HEAD" };
} else {
  const f = spawnSync("git", ["fetch", "--depth=1", "origin", "main"], { stdio: "pipe", encoding: "utf8" });
  if (f.status === 0) {
    // Fail closed: a missing or stale pin would make the two old-app checks pass or fail against the wrong source.
    const u = spawnSync("git", ["update-ref", "refs/taskdrop/old-main", "FETCH_HEAD"], { stdio: "pipe", encoding: "utf8" });
    if (u.status !== 0) fail(`FAILED to pin the fetched main branch: ${(u.stderr || "").trim().split("\n").pop()}`);
    oldAppEnv = { OLD_APP_REF: "refs/taskdrop/old-main" };
  } else {
    warn(`Cannot fetch \`main\` here (${(f.stderr || "").trim().split("\n").pop()}). The old-app contract check and the old-app database check are SKIPPED on this deploy. Run them by hand: npm run test:contract and node scripts/check-old-app-db.mjs.`);
  }
}

if (oldAppEnv) must("old-app contract", "npm", ["run", "test:contract"], oldAppEnv);
must("apply new migrations", "node", ["scripts/deploy-migrations.mjs"]);
if (oldAppEnv) must("old app still has its tables and functions", "node", ["scripts/check-old-app-db.mjs"], oldAppEnv);
await mustRetry("deploy Edge Functions", "npx", ["--yes", "supabase@2", "functions", "deploy", "--project-ref", projectId, "--use-api"]);

// Tell Inngest Cloud to re-read the function list (the request is signed on the way back, so no secret).
// A warning, not a failure, until the Inngest keys are set (docs/INNGEST.md): the code is already deployed.
note(`Inngest sync: PUT ${functionUrl}`);
if (!dryRun) {
  try {
    const res = await fetch(functionUrl, { method: "PUT", signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    console.log(text);
    if (!res.ok || !text.includes("Successfully registered")) warn("Inngest sync did not report success; the backend is deployed anyway. See docs/INNGEST.md.");
  } catch (e) {
    warn(`Inngest sync failed: ${e.message}`);
  }
}
note("backend deployed");
