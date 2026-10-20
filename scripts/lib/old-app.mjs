import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * The old app is `main`: the app, the old admin's database use and the Edge Functions
 * as they are deployed for the testers today. Compatibility checks (ground rule 4 in
 * docs/UPGRADE_PLAN.md) compare the upgrade against it.
 *
 * Returns a folder holding `supabase/functions` and `apps/mobile/src` of the old app:
 * OLD_APP_DIR when set (CI checks `main` out there), otherwise `main` read out of this
 * repository's git history into a temp folder (OLD_APP_REF names the ref; default `main`,
 * and `origin/main` on Vercel, where only the pushed branch is cloned).
 */
export function oldAppDir(repo) {
  const given = process.env.OLD_APP_DIR;
  if (given) {
    if (!existsSync(join(given, "supabase/functions/api/ops.ts"))) throw new Error(`OLD_APP_DIR=${given} has no supabase/functions/api/ops.ts`);
    return resolve(given);
  }
  const ref = process.env.OLD_APP_REF || "main";
  const out = mkdtempSync(join(tmpdir(), "taskdrop-old-app-"));
  try {
    const files = execFileSync("git", ["-C", repo, "ls-tree", "-r", "--name-only", ref, "supabase/functions", "apps/mobile/src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => /\.tsx?$/.test(f));
    for (const f of files) {
      mkdirSync(dirname(join(out, f)), { recursive: true });
      writeFileSync(join(out, f), execFileSync("git", ["-C", repo, "show", `${ref}:${f}`], { maxBuffer: 64 * 1024 * 1024 }));
    }
  } catch {
    throw new Error("Cannot find the old app. Set OLD_APP_DIR to a checkout of `main`, or run this inside the repository so `main` can be read from git.");
  }
  return out;
}
