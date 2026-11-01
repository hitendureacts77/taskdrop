#!/usr/bin/env node
/**
 * Security round 1, test T2 (docs/ULTIMATE_PLAN.md task 2.7): looks for a secret in every line ever
 * added to the repository, on every branch. The same rules as the commit guard (scripts/lib/secret-patterns.mjs).
 * Prints the commit, the file and the rule name, never the value.
 *
 *   node scripts/secret-history.mjs            all branches
 *   node scripts/secret-history.mjs --since=2026-10-01
 *
 * Findings that are accepted on purpose are listed in ACCEPTED below with the reason.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { forbiddenFile, scanText } from './lib/secret-patterns.mjs';

/** commit-agnostic: `file|rule`. The plan's Security section accepts an old Razorpay TEST key in the history. */
const ACCEPTED = new Map([
  ['supabase/functions/_shared/secrets.ts|razorpay-test-key', 'old Razorpay TEST key, accepted in the plan (Security section, 31 Oct)'],
  ['supabase/functions/_shared/secrets.ts|secret-assignment', 'same commit: the matching Razorpay TEST secret'],
]);

const SKIP = /(^|\/)(package-lock\.json|node_modules\/)|\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|mp4|mov|zip|aab|apk)$/i;

const since = process.argv.find((a) => a.startsWith('--since='));
const args = ['log', '--all', '-p', '--no-color', '--no-ext-diff', '--format=@@@%H', '-U0', ...(since ? [`--since=${since.slice(8)}`] : [])];
const git = spawn('git', args, { stdio: ['ignore', 'pipe', 'inherit'] });
const rl = createInterface({ input: git.stdout, crlfDelay: Infinity });

let commit = '';
let file = '';
let commits = 0;
const found = new Map(); // key -> {commit, file, rule, count}

for await (const line of rl) {
  if (line.startsWith('@@@')) {
    commit = line.slice(3, 11);
    commits++;
  } else if (line.startsWith('+++ b/')) {
    file = line.slice(6);
    if (forbiddenFile(file)) {
      const key = `${file}|forbidden-file`;
      if (!found.has(key)) found.set(key, { commit, file, rule: 'forbidden-file', count: 1 });
    }
  } else if (line.startsWith('+') && !line.startsWith('+++') && !SKIP.test(file)) {
    for (const hit of scanText(line.slice(1))) {
      const key = `${file}|${hit.rule}`;
      const prev = found.get(key);
      if (prev) prev.count++;
      else found.set(key, { commit, file, rule: hit.rule, count: 1 });
    }
  }
}

const open = [...found.entries()].filter(([k]) => !ACCEPTED.has(k)).map(([, v]) => v);
console.log(`scanned ${commits} commits on all branches: ${open.length} finding(s)${found.size > open.length ? `, ${found.size - open.length} accepted` : ''}`);
for (const f of open) console.log(`  ${f.commit} ${f.file}: ${f.rule} (${f.count} line${f.count > 1 ? 's' : ''})`);
process.exit(open.length ? 1 : 0);
