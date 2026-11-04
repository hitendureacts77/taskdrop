// The parts of the two-person test (scripts/two-person-test.mjs, task 2.13 part G) that need no network,
// so `npm test` can check them on every change.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Operations that are not probed, each with the reason. Everything else is. */
export const SKIPPED = {
  deleteMyAccount: 'would delete the account the test is signed in with',
  endMySessions: 'would end the test sessions; covered by supabase/tests/session_cutoff.test.sql',
};

/** Names of the operations the api offers, read from its source (same layout rule as security-round2.mjs). */
export function opNames(root = ROOT) {
  const names = new Set();
  for (const f of ['reads.ts', 'writes.ts', 'media.ts']) {
    const src = readFileSync(`${root}/supabase/functions/api/${f}`, 'utf8');
    for (const m of src.matchAll(/^ {2}([a-z][A-Za-z]+):\s/gm)) names.add(m[1]);
  }
  return [...names].sort();
}

/** Which of those only read: the names in reads.ts. */
export function readOpNames(root = ROOT) {
  const src = readFileSync(`${root}/supabase/functions/api/reads.ts`, 'utf8');
  return new Set([...src.matchAll(/^ {2}([a-z][A-Za-z]+):\s/gm)].map((m) => m[1]));
}

/** Operations the test will send, with the skipped ones taken out. A name that no longer exists is reported. */
export function probedOps(root = ROOT) {
  const all = opNames(root);
  const gone = Object.keys(SKIPPED).filter((n) => !all.includes(n));
  if (gone.length) throw new Error(`scripts/lib/two-person.mjs skips ${gone.join(', ')}, which no longer exist. Remove them from SKIPPED.`);
  return all.filter((n) => !(n in SKIPPED));
}

/** Every string anywhere in a JSON value. */
export function strings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

/** Every uuid anywhere in a JSON value, by the key it sits under (array items take their parent's key). */
export function uuidsByKey(value, key = '', out = {}) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof value === 'string') {
    if (UUID.test(value)) (out[key] ??= new Set()).add(value);
  } else if (Array.isArray(value)) {
    for (const v of value) uuidsByKey(v, key, out);
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) uuidsByKey(v, k, out);
  }
  return out;
}

/** The markers (private strings) found in a piece of text, ignoring case. */
export function leaked(text, markers) {
  const t = String(text ?? '').toLowerCase();
  return markers.filter((m) => m && t.includes(String(m).toLowerCase()));
}

/** The phone in the forms it shows up in: bare ten digits is enough, as the others contain it. */
export const phoneMarker = (tenDigits) => String(tenDigits).replace(/\D/g, '').slice(-10);

/** A short, stable picture of person B's private state, to compare before and after A has tried things. */
export function stateOf({ tasks, destinations, wallet, notifications }) {
  const rows = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' && Array.isArray(v.rows) ? v.rows : []);
  return JSON.stringify({
    tasks: rows(tasks).map((t) => [t.id, t.status, t.title]).sort(),
    destinations: rows(destinations).map((d) => [d.id, d.upi_id ?? d.upiId ?? null, d.is_default ?? d.isDefault ?? null]).sort(),
    wallet: wallet ?? null,
    notifications: rows(notifications).length,
  });
}
