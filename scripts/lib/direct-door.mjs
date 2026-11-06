// The parts of the direct-door test (scripts/direct-door-test.mjs, plan task 2.18 part B) that need no network,
// so `npm test` can check them on every change.
//
// The direct door is the database's own REST address, /rest/v1/<table>. The app never uses it (everything goes
// through the `api` function), but every signed-in person can knock on it with the public key, and row rules are the
// only lock. Plan holes H3 and H52; it closes with task 3.9 (--gateway-only).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { targetRefusal } from './two-person.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Why `url` may not be tested against, or null when it is the staging project. The same guard as two-person-test. */
export { targetRefusal };

/**
 * Every table in `public`, read from the migrations (no signed-out schema listing exists). A table that is created
 * and later dropped is left out. Case and quotes are ignored.
 */
export function tablesFromMigrations(dir = join(ROOT, 'supabase/migrations')) {
  const live = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, f), 'utf8').split('\r').join('');
    // Walk the file in order, so a drop followed by a create in the same file ends up created.
    const re = /\b(create|drop)\s+table\s+(?:if\s+(?:not\s+)?exists\s+)?public\."?([a-z_][a-z0-9_]*)"?/gi;
    for (const m of sql.matchAll(re)) {
      if (m[1].toLowerCase() === 'create') live.add(m[2].toLowerCase());
      else live.delete(m[2].toLowerCase());
    }
  }
  return [...live].sort();
}

/** Table names from a file with one name per line; blank lines and # comments are ignored. */
export function parseTableList(text) {
  const names = [];
  for (const raw of String(text).split('\n')) {
    const line = raw.split('#')[0].trim();
    if (!line) continue;
    if (!/^[a-z_][a-z0-9_]*$/.test(line)) throw new Error(`not a table name: ${line.slice(0, 40)}`);
    names.push(line);
  }
  return [...new Set(names)].sort();
}

/**
 * Columns that say whose row it is, in the order they are tried. A table is asked about person B through the first
 * one it has (a missing column comes back as a 400 with code 42703 and the next one is tried). `profiles` has no
 * owner column: the row's own id is the person.
 */
export const OWNER_COLUMNS = [
  'user_id', 'owner_id', 'owner', 'poster_id', 'worker_id', 'sender_id', 'author_id', 'reporter_id', 'blocker_id',
  'referrer_id', 'created_by', 'opened_by',
];

/**
 * Tables where another signed-in person may read some of B's rows ON PURPOSE (row rules: profiles_select_all,
 * reviews_select_all, tasks_select_visible for open tasks, settings_select_authenticated). Reading them is not a
 * leak; everything else must show person A none of B's rows.
 */
export const PUBLIC_BY_DESIGN = new Set(['profiles', 'tasks', 'reviews', 'settings']);

/**
 * Tables where the other side of a shared task may read B's rows on purpose (row rules: participants, the poster and
 * the assigned worker). The seed people A and B work on tasks together, so A reading B's message or dispute there is
 * the rule working, not a leak. The two-person test (2.13 G) is what proves a STRANGER gets nothing.
 */
export const PARTY_VISIBLE = new Set(['messages', 'bids', 'assignments', 'task_disputes', 'task_proofs', 'crew_messages']);

/**
 * Tables with no owner column that no plain person may read any row of (staff only, or the server only). A row
 * showing up here for person A is a leak even though it cannot be tied to B.
 */
export const NEVER_FOR_A_PERSON = new Set([
  'admin_alerts', 'admin_audit_log', 'admin_live_events', 'admin_staff', 'app_controls', 'auth_codes', 'auth_send_log',
  'cancellations_log', 'crm_broadcasts', 'crm_leads', 'crm_notes', 'crm_owners', 'crm_rules', 'crm_segments', 'crm_tags',
  'crm_tasks', 'crm_user_tags', 'dispute_decisions', 'message_moderation', 'password_attempts', 'places_quota',
  'platform_ledger', 'reconciliation_runs', 'review_moderation', 'sms_daily', 'task_moderation', 'task_questions',
  'user_suspensions', 'user_sync', 'user_warnings', 'account_deletions', 'copyright_notices',
]);

/** The one read the test is allowed to make: GET, under /rest/v1/, no body. Anything else throws. */
export function readRequest(base, table, column, personId) {
  if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw new Error(`not a table name: ${table}`);
  if (column !== null && !/^[a-z_][a-z0-9_]*$/.test(column)) throw new Error(`not a column name: ${column}`);
  if (personId !== null && !/^[0-9a-f-]{36}$/i.test(personId)) throw new Error('not a person id');
  const query = column
    ? `select=${column}&${column}=eq.${personId}&limit=0`
    : `select=*&limit=0`;
  const path = `/rest/v1/${table}?${query}`;
  return { method: 'GET', path, url: `${base}${path}` };
}

/** What came back, reduced to what may be printed: never a row value. `count` is null when unknown. */
export function summarise(status, bodyText, contentRange) {
  let code = null;
  if (status >= 400) {
    try {
      const j = JSON.parse(bodyText);
      code = typeof j?.code === 'string' ? j.code : null;
    } catch {
      /* not JSON */
    }
  }
  const m = /\/(\d+)$/.exec(contentRange || '');
  return { status, code, count: m ? Number(m[1]) : null };
}

/** True when the database said the column does not exist. */
export const noSuchColumn = (s) => s.status === 400 && (s.code === '42703' || s.code === '22P02');

/** True when the request was turned away: no rights, not found or not exposed, or not allowed. */
export const refused = (s) => s.status === 401 || s.status === 403 || s.status === 404 || (s.status >= 400 && s.status < 500 && s.code !== '42703' && s.code !== '22P02');

/**
 * The verdict for one answer.
 *  who        'signed-out' or 'person-a'
 *  kind       'owner' (asked for B's rows through an owner column) or 'global' (no owner column: asked for everything visible)
 *  gatewayOnly after task 3.9: every answer must be a refusal
 * Returns { verdict: 'ok' | 'by-design' | 'fail', why }.
 */
export function judge({ who, table, kind, summary, gatewayOnly }) {
  const s = summary;
  if (gatewayOnly) {
    return refused(s)
      ? { verdict: 'ok', why: 'refused' }
      : { verdict: 'fail', why: `the direct door answered (status ${s.status})` };
  }
  if (refused(s)) return { verdict: 'ok', why: 'refused' };
  if (s.status >= 500) return { verdict: 'fail', why: `server error ${s.status}${s.code ? ` (${s.code})` : ''}` };
  const n = s.count ?? 0;
  if (n === 0) return { verdict: 'ok', why: 'no rows' };
  if (who === 'signed-out') return { verdict: 'fail', why: `signed out read ${n} row(s)` };
  if (PUBLIC_BY_DESIGN.has(table)) return { verdict: 'by-design', why: `${n} row(s), public on purpose` };
  if (PARTY_VISIBLE.has(table)) return { verdict: 'by-design', why: `${n} row(s) on a task A shares with B (participants may read; confirm A is a party)` };
  if (kind === 'global' && !NEVER_FOR_A_PERSON.has(table)) {
    return { verdict: 'by-design', why: `${n} row(s) with no owner column (cannot be tied to B: check by hand if unexpected)` };
  }
  return { verdict: 'fail', why: `person A read ${n} of B's row(s)` };
}

/** The request line a failure prints: method, path, who asked. No key and no token. */
export const describeRequest = (req, who) => `${req.method} ${req.path}   (as ${who === 'person-a' ? 'person A' : 'signed out'})`;
