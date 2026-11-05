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

// ------------------------------------------------------------ the cache section (plan 3.5b task 8) ----

/** Hosts this test must never be pointed at, whatever else is set: production. */
export const PRODUCTION_HOSTS = ['taskdrop.in', 'www.taskdrop.in', 'admin.taskdrop.in'];

/** The only host the test runs against (the staging Supabase project), as in staging-session.mjs. */
export const STAGING_HOST = 'wjxvingpfbfvkfqhrguj.supabase.co';

/** Why `url` may not be tested against, or null when it is the staging project. */
export function targetRefusal(url) {
  if (!url) return 'EXPO_PUBLIC_SUPABASE_URL is not set';
  let host;
  try {
    host = new globalThis.URL(url).hostname.toLowerCase();
  } catch {
    return `not a URL: ${String(url).slice(0, 60)}`;
  }
  if (PRODUCTION_HOSTS.includes(host) || host.endsWith('.taskdrop.in')) return `${host} is production; this test only runs against staging`;
  if (host !== STAGING_HOST) return `${host} is not the staging project (${STAGING_HOST})`;
  return null;
}

/** The keys of a frozen `NAME = Object.freeze({ key: ..., })` or `new Set([...])` list in a source file. */
function listIn(src, name, file) {
  const at = src.indexOf(name);
  if (at < 0) throw new Error(`${file} no longer has ${name}; update scripts/lib/two-person.mjs`);
  const open = src.indexOf('(', at);
  let depth = 0;
  let end = open;
  for (; end < src.length; end++) {
    if (src[end] === '(') depth++;
    else if (src[end] === ')' && --depth === 0) break;
  }
  const body = src.slice(open, end).replace(/\/\/[^\n]*/g, '');
  const keys = [...body.matchAll(/^\s*([a-z][A-Za-z]+):/gm)].map((m) => m[1]);
  return keys.length ? keys : [...body.matchAll(/'([a-z][A-Za-z]+)'/g)].map((m) => m[1]);
}

/** The server's same-for-everyone reads (PUBLIC_MEMO_OPS in supabase/functions/api/publicMemo.ts). */
export function memoOpNames(root = ROOT) {
  return listIn(readFileSync(`${root}/supabase/functions/api/publicMemo.ts`, 'utf8'), 'PUBLIC_MEMO_OPS = ', 'publicMemo.ts');
}

/** The reads the app never answers from memory (NEVER_REUSE in apps/mobile/src/lib/freshness.ts). */
export function neverReuseOpNames(root = ROOT) {
  return listIn(readFileSync(`${root}/apps/mobile/src/lib/freshness.ts`, 'utf8'), 'NEVER_REUSE: ', 'freshness.ts');
}

/** The signed-in reads a guest may also make, as they are (SHARED in supabase/functions/api/guest.ts). */
export function guestSharedOpNames(root = ROOT) {
  const src = readFileSync(`${root}/supabase/functions/api/guest.ts`, 'utf8');
  const m = src.match(/const SHARED = \[([^\]]*)\]/);
  if (!m) throw new Error('guest.ts no longer has SHARED; update scripts/lib/two-person.mjs');
  return [...m[1].matchAll(/"([a-zA-Z]+)"/g)].map((x) => x[1]);
}

/** The arguments each shared read is called with. A new shared read must be added here (the unit test says so). */
export const MEMO_ARGS = {
  trendingCategories: [{ limit: 8 }],
  topEarners: [{ kind: 'top_rated', limit: 10 }, { kind: 'most_active', limit: 10 }, { kind: 'new_talent', limit: 10 }],
  platformHighlights: [{}],
  promotionTiers: [{}],
  adAuctionRanks: [{}],
};

/** Every shared read with its arguments, and whether a guest may make it (if not, a guest must be refused). */
export function memoProbes(root = ROOT) {
  const guest = new Set(guestSharedOpNames(root));
  return memoOpNames(root).flatMap((op) => {
    if (!MEMO_ARGS[op]) throw new Error(`${op} is a shared read with no arguments in MEMO_ARGS (scripts/lib/two-person.mjs)`);
    return MEMO_ARGS[op].map((args) => ({ op, args, guest: guest.has(op) }));
  });
}

/**
 * Shared reads whose answer is a list of public people cards: there, a person's own id may appear as the
 * card's `id` (a top helper is public). Their phone, email and money never may, and no id anywhere else.
 */
export const PUBLIC_CARD_ID_KEYS = { topEarners: ['id'] };

/** Keys that hold private things and must never appear in a shared answer, at any depth. */
export const PRIVATE_KEYS = /^(phone|email|balance|balance_minor|available_minor|pending_minor|held_minor|upi_id|upiId|payout_upi|wallet)$/i;

/**
 * What in a shared answer is private: a key from PRIVATE_KEYS, or one of the person markers (ids, phone,
 * email) anywhere, except a person's id sitting under a public card key of that op.
 */
export function privateHits(op, value, markers) {
  const allowedIdKeys = new Set(PUBLIC_CARD_ID_KEYS[op] ?? []);
  const ids = new Set(markers.ids.map((s) => s.toLowerCase()));
  const all = [...markers.ids, ...markers.other].filter(Boolean).map((s) => String(s).toLowerCase());
  const hits = [];
  const walk = (v, key) => {
    if (typeof v === 'string' || typeof v === 'number') {
      const s = String(v).toLowerCase();
      for (const m of all) {
        if (!s.includes(m)) continue;
        if (ids.has(m) && s === m && allowedIdKeys.has(key)) continue;
        hits.push(`${key || '(top)'}: ${m}`);
      }
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, key);
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        if (PRIVATE_KEYS.test(k)) hits.push(`key ${k}`);
        walk(x, k);
      }
    }
  };
  walk(value, '');
  return [...new Set(hits)];
}

/** The answers of several callers to one read, as text; null when they are all byte-identical. */
export function differences(answers) {
  const texts = Object.entries(answers).map(([who, v]) => [who, JSON.stringify(v ?? null)]);
  const first = texts[0]?.[1];
  const odd = texts.filter(([, t]) => t !== first).map(([who]) => who);
  return odd.length ? `${texts[0][0]} differs from ${odd.join(', ')}` : null;
}

/** The plan the cache section follows, printed by --dry-run. */
export function cachePlan(root = ROOT) {
  const probes = memoProbes(root);
  return [
    'Cache section (plan 3.5b task 8): staging only, fake seed accounts.',
    `1. Person A, person B and a guest each call every shared read (${probes.length} calls each, all at once, up to 3 tries if a number moves between calls):`,
    ...probes.map((p) => `     ${p.op} ${JSON.stringify(p.args)}${p.guest ? '' : '  (guest must be told to make an account)'}`),
    '   The answers must be byte-identical, carry no private key (phone, email, balance, UPI) and none of A\'s or B\'s ids, phone or email (a top helper\'s card id excepted).',
    `2. Never-reused reads (${neverReuseOpNames(root).length} in NEVER_REUSE): getWallet and listPayoutDestinations must answer with "Cache-Control: no-store",`,
    '   and B\'s payout list must show a destination added between two calls a moment apart, and stop showing it once removed.',
    '3. Account switch: A reads getWallet, listMyTasks and listNotifications, then B reads the same at once: B\'s answers must never contain A\'s id,',
    '   and B\'s own wallet must show B\'s id (the control that proves the check can see an id).',
  ];
}

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
