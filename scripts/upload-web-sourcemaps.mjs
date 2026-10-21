/**
 * After `expo export -p web --source-maps`: send the web bundle's source maps to
 * Sentry so errors from taskdrop.in show readable stacks, then delete every .map
 * file so nobody can read the app's source from the site.
 *
 * The bundles carry Debug IDs (added by the Sentry Metro config), so Sentry
 * matches a crash to its map without a release name.
 *
 * Needs SENTRY_AUTH_TOKEN in the build environment (Vercel, project `taskdrop`,
 * a secret; never an EXPO_PUBLIC_ name). Without it, or if the upload fails,
 * the maps are still deleted and this exits 1, which the build reports as a
 * warning: the site works either way.
 *
 *   node scripts/upload-web-sourcemaps.mjs [dist-dir]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve(process.argv[2] || "apps/mobile/dist");

function maps(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...maps(p));
    else if (e.name.endsWith(".map")) out.push(p);
  }
  return out;
}

let ok = false;
if (!process.env.SENTRY_AUTH_TOKEN) {
  console.log("[sourcemaps] SENTRY_AUTH_TOKEN is not set; nothing uploaded.");
} else {
  const cli = join("node_modules", ".bin", process.platform === "win32" ? "sentry-cli.cmd" : "sentry-cli");
  const r = spawnSync(cli, ["sourcemaps", "upload", "--org", "hitendu", "--project", "taskdrop", dist], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  ok = r.status === 0;
}

const found = existsSync(dist) ? maps(dist) : [];
for (const f of found) rmSync(f);
console.log(`[sourcemaps] removed ${found.length} .map file(s) from ${dist}`);
process.exit(ok ? 0 : 1);
