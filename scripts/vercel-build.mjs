#!/usr/bin/env node
/**
 * The build command for the `taskdrop` and `taskdrop-production` Vercel projects (see vercel.json).
 * It only builds the web app:
 *
 *   1. web export               npm run web:export
 *   2. scan the build           scripts/scan-build.mjs apps/mobile/dist  (task 2.18 D: a key in the bundle, or a missing build, stops the deploy)
 *   3. web source maps          scripts/upload-web-sourcemaps.mjs  (warning only)
 *
 * Since 22 Nov 2026 (plan task 5.12) the staging backend (old-app contract, migrations, old-app database
 * check, Edge Functions, Inngest sync) is deployed by .github/workflows/deploy-staging.yml with
 * scripts/deploy-staging-backend.mjs, and the web app moves to Cloudflare (scripts/cloudflare-web-build.mjs).
 * This script and vercel.json are removed when Vercel is switched off (5.12 step 10).
 * The production database waits for the owner's Approve in .github/workflows/production-database.yml.
 *
 *   node scripts/vercel-build.mjs --dry-run   print what would run
 */
import { spawnSync } from "node:child_process";

const dryRun = process.argv.includes("--dry-run");
const branch = process.env.VERCEL_GIT_COMMIT_REF || "";
const target = process.env.VERCEL_ENV || "";

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

note(`branch "${branch || "(none)"}" / environment "${target || "(none)"}": web build only; the staging backend is deployed by GitHub Actions (deploy-staging.yml)`);

must("web export", "npm", ["run", "web:export"]);

// Task 2.18 part D (hole H72): scan what is about to be published. A key in the bundle, or no build at all, fails the build,
// so the previous deployment stays live. It runs before the source-map step below, so the maps are scanned too.
must("scan the web build for secrets", "node", ["scripts/scan-build.mjs", "apps/mobile/dist"]);

// Readable stacks for web errors: send the source maps to Sentry, then delete them so they are never public.
// A failure here is a warning: the site is fine without them, only Sentry's stacks are harder to read.
if (!run("web source maps", "node", ["scripts/upload-web-sourcemaps.mjs"])) warn("Web source maps were not uploaded; web errors in Sentry will show minified stacks.");
