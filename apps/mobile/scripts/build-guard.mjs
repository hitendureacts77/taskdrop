#!/usr/bin/env node
/**
 * The build guard (plan task 5.0a, hole H15): says whether this build mixes the staging and
 * production copies. The same check already runs inside app.config.js, so every build, update and
 * export stops by itself; this command is for people and for workflow steps that want the answer
 * on its own, before spending a build.
 *
 *   APP_VARIANT=production node apps/mobile/scripts/build-guard.mjs            (add --android for an Android build)
 *   node apps/mobile/scripts/build-guard.mjs --variant=staging
 *
 * Prints names and plain sentences only, never a value. Exit 1 if anything is wrong.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkVariant, resolveVariant } = require('../variant.cjs');

const args = process.argv.slice(2);
const env = { ...process.env };
const flag = args.find((a) => a.startsWith('--variant='));
if (flag) env.APP_VARIANT = flag.slice('--variant='.length);
const androidBuild = args.includes('--android') || env.EAS_BUILD_PLATFORM === 'android';

const problems = checkVariant(env, { androidBuild });
const variant = resolveVariant(env);
if (problems.length) {
  console.error(`Build guard: STOP (variant "${variant}")`);
  for (const p of problems) console.error(` - ${p}`);
  process.exit(1);
}
console.log(`Build guard: all clear (variant "${variant}"${androidBuild ? ', Android' : ''})`);
