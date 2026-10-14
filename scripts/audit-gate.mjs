// The dependency-security gate CI runs instead of a bare `npm audit`.
//
// `npm audit --audit-level=moderate` fails on every advisory, including ones
// nobody can fix yet (no patched release exists, or the fix is a major upgrade of
// a build tool that cannot be tested here). Left alone that makes CI permanently
// red, and a permanently red check hides new problems. This gate keeps CI strict
// and honest instead:
//
//   * any moderate-or-higher advisory NOT listed in audit-exceptions.json fails;
//   * an advisory of critical severity can never be excepted;
//   * every exception carries a reason and a review-by date, and fails once that
//     date has passed, so an accepted risk is looked at again rather than forgotten;
//   * an exception for an advisory that no longer appears is reported, so it gets
//     removed.
//
// Run:  npm run audit:gate        (needs network access, like `npm audit`)
// Test: node --test scripts/audit-gate.test.mjs

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
/** Advisories below this severity are ignored, like `--audit-level=moderate`. */
const MIN_SEVERITY = 'moderate';

/** The advisory id from its URL: .../advisories/GHSA-xxxx-xxxx-xxxx */
const idOf = (url) => String(url ?? '').split('/').pop() || String(url ?? '');

/** Every distinct advisory in an `npm audit --json` report. */
export function advisoriesIn(report) {
  const found = new Map();
  for (const [name, v] of Object.entries(report?.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (via && typeof via === 'object' && via.url) {
        const id = idOf(via.url);
        if (!found.has(id)) {
          found.set(id, { id, package: via.name ?? name, severity: via.severity ?? 'moderate', title: via.title ?? '', range: via.range ?? '', url: via.url });
        }
      }
    }
  }
  return [...found.values()].filter((a) => (RANK[a.severity] ?? 0) >= RANK[MIN_SEVERITY]);
}

/**
 * Decide what the audit means. Pure, so it can be tested.
 * @returns {{ failures: string[], accepted: object[], notices: string[] }}
 */
export function evaluate(report, exceptions, nowMs = Date.now()) {
  const failures = [];
  const accepted = [];
  const notices = [];
  const byId = new Map((exceptions ?? []).map((e) => [e.id, e]));
  const advisories = advisoriesIn(report);
  const present = new Set(advisories.map((a) => a.id));

  for (const a of advisories) {
    const ex = byId.get(a.id);
    const label = `${a.severity} ${a.package}: ${a.title} (${a.id})`;
    if (!ex) {
      failures.push(`New advisory, not in audit-exceptions.json: ${label}`);
    } else if (a.severity === 'critical') {
      failures.push(`A critical advisory cannot be excepted: ${label}`);
    } else if (!ex.reason || !String(ex.reason).trim()) {
      failures.push(`The exception for ${a.id} has no reason.`);
    } else if (!Number.isFinite(Date.parse(ex.reviewBy))) {
      failures.push(`The exception for ${a.id} has no valid reviewBy date.`);
    } else if (Date.parse(ex.reviewBy) < nowMs) {
      failures.push(`The exception for ${a.id} (${a.package}) expired on ${ex.reviewBy}. Re-check it: is a fix available now?`);
    } else {
      accepted.push({ ...a, reason: ex.reason, reviewBy: ex.reviewBy });
    }
  }

  for (const e of exceptions ?? []) {
    if (!present.has(e.id)) notices.push(`The exception for ${e.id} (${e.package}) is no longer needed: the advisory is gone. Remove it from audit-exceptions.json.`);
  }
  return { failures, accepted, notices };
}

function main() {
  const exceptions = JSON.parse(readFileSync(new URL('../audit-exceptions.json', import.meta.url), 'utf8'));
  const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  let report;
  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error('Could not read the output of `npm audit --json`:');
    console.error((run.stderr || run.stdout || '(nothing)').slice(0, 2000));
    process.exit(2);
  }
  if (report.error) {
    console.error(`npm audit could not run: ${report.error.summary ?? report.error.code}`);
    process.exit(2);
  }

  const { failures, accepted, notices } = evaluate(report, exceptions);
  const total = advisoriesIn(report).length;
  console.log(`${total} advisories at moderate or above: ${accepted.length} accepted with a reason, ${failures.length} not.`);
  for (const a of accepted) console.log(`  accepted  ${a.severity.padEnd(8)} ${a.package.padEnd(12)} ${a.id}  (review by ${a.reviewBy})`);
  for (const n of notices) console.log(`  notice    ${n}`);
  for (const f of failures) console.error(`  FAIL      ${f}`);
  if (failures.length) {
    console.error('\nFix the dependency, or (never for a critical one) add a reasoned, dated exception to audit-exceptions.json.');
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
