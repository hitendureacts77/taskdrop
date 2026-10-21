#!/usr/bin/env node
/**
 * The build command for the `taskdrop` Vercel project on `redesigned-2.0` (see vercel.json).
 * Vercel runs every deploy; GitHub only stores the code (docs/DEPLOY.md).
 *
 * On a push to `redesigned-2.0` it first puts the backend on the shared test project, then builds
 * the web app. On every other branch (and for production builds) it only builds the web app.
 *
 *   1. old-app contract         npm run test:contract         (needs `main`; see below)
 *   2. new migrations           scripts/deploy-migrations.mjs
 *   3. old-app database check   scripts/check-old-app-db.mjs  (needs `main`)
 *   4. function secrets         scripts/sync-function-secrets.mjs  (Vercel -> Supabase; a warning if it fails)
 *   5. Edge Functions           supabase functions deploy
 *   6. Inngest sync             warning only, until the Inngest Cloud keys are set
 *   7. web export               npm run web:export
 *
 * A failed step 1-4 fails the build, so the web app is never published against a half-updated
 * backend (the previous deployment stays live). Steps 1 and 3 compare against `main`: Vercel only
 * clones the pushed branch, so the script fetches `main` first; if that fails it says so loudly and
 * skips those two checks instead of blocking every deploy.
 *
 * Needs these in Vercel -> `taskdrop` -> Settings -> Environment Variables (set to All Environments;
 * this script only uses them for Preview builds of `redesigned-2.0`; docs/DEPLOY.md). Without them the
 * backend step is skipped with a notice:
 *   SUPABASE_ACCESS_TOKEN   deploys Edge Functions (supabase.com -> Account -> Access Tokens)
 *   DATABASE_URL            the test project's Session pooler connection string, with its password
 *
 *   node scripts/vercel-build.mjs --dry-run   print what would run (set VERCEL_GIT_COMMIT_REF and VERCEL_ENV)
 */
import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const branch = process.env.VERCEL_GIT_COMMIT_REF || "";
const target = process.env.VERCEL_ENV || "";
const projectId = process.env.SUPABASE_PROJECT_ID || "wjxvingpfbfvkfqhrguj";
const functionUrl = `https://${projectId}.supabase.co/functions/v1/inngest`;

const note = (m) => console.log(`[vercel-build] ${m}`);
const warn = (m) => console.log(`::warning:: [vercel-build] ${m}`);

function run(label, cmd, args, env = {}) {
  note(`${label}: ${cmd} ${args.join(" ")}`);
  if (dryRun) return true;
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  return r.status === 0;
}
function must(label, cmd, args, env) {
  if (!run(label, cmd, args, env)) {
    console.error(`[vercel-build] FAILED at "${label}". Nothing after it ran, so the web app is not published. Fix it and push again.`);
    process.exit(1);
  }
}

const wantsBackend = branch === "redesigned-2.0" && target === "preview";
const hasSecrets = Boolean(process.env.SUPABASE_ACCESS_TOKEN && process.env.DATABASE_URL);

if (!wantsBackend) {
  note(`branch "${branch || "(none)"}" / environment "${target || "(none)"}": web build only, backend untouched`);
} else if (!hasSecrets) {
  warn("Backend NOT deployed: add SUPABASE_ACCESS_TOKEN and DATABASE_URL in Vercel (Preview, branch redesigned-2.0). See docs/DEPLOY.md. Building the web app only.");
} else {
  // `main` is the old app. Vercel cloned only this branch, so fetch main to compare against.
  let oldAppEnv = null;
  if (dryRun) {
    note("fetch main: git fetch --depth=1 origin main");
    oldAppEnv = { OLD_APP_REF: "FETCH_HEAD" };
  } else {
    const f = spawnSync("git", ["fetch", "--depth=1", "origin", "main"], { stdio: "pipe", encoding: "utf8" });
    if (f.status === 0) {
      // Fail closed: a missing or stale pin would make the two old-app checks pass or fail against the wrong source.
      const u = spawnSync("git", ["update-ref", "refs/taskdrop/old-main", "FETCH_HEAD"], { stdio: "pipe", encoding: "utf8" });
      if (u.status !== 0) {
        console.error(`[vercel-build] FAILED to pin the fetched main branch: ${(u.stderr || "").trim().split("\n").pop()}`);
        process.exit(1);
      }
      oldAppEnv = { OLD_APP_REF: "refs/taskdrop/old-main" };
    } else {
      warn(`Cannot fetch \`main\` here (${(f.stderr || "").trim().split("\n").pop()}). The old-app contract check and the old-app database check are SKIPPED on this build. Run them before merging: npm run test:contract and node scripts/check-old-app-db.mjs.`);
    }
  }

  if (oldAppEnv) must("old-app contract", "npm", ["run", "test:contract"], oldAppEnv);
  must("apply new migrations", "node", ["scripts/deploy-migrations.mjs"]);
  if (oldAppEnv) must("old app still has its tables and functions", "node", ["scripts/check-old-app-db.mjs"], oldAppEnv);
  // Edge Function secrets are kept in Vercel (one place to edit); copy the allow-listed ones across. A failure only warns:
  // the functions keep the secrets they already have.
  if (!run("function secrets", "node", ["scripts/sync-function-secrets.mjs"])) warn("Function secrets were not synced to Supabase; the functions keep the secrets they had. See scripts/sync-function-secrets.mjs.");
  must("deploy Edge Functions", "npx", ["--yes", "supabase@2", "functions", "deploy", "--project-ref", projectId, "--use-api"]);

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
}

must("web export", "npm", ["run", "web:export"]);

// Readable stacks for web errors: send the source maps to Sentry, then delete them so they are never public.
// A failure here is a warning: the site is fine without them, only Sentry's stacks are harder to read.
if (!run("web source maps", "node", ["scripts/upload-web-sourcemaps.mjs"])) warn("Web source maps were not uploaded; web errors in Sentry will show minified stacks.");
