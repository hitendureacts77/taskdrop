/**
 * Whether what the app read a moment ago can still stand.
 *
 * Tabs refresh quietly when they come back into view, and the header and the
 * tab bar recount their badges on every screen change. Coming back a few
 * seconds after leaving, with nothing changed since, asked the server for
 * exactly what was already on screen: a whole Home, a dozen reads, for a peek
 * at one task.
 *
 * "Nothing changed" is something the app can know. Every change this person
 * makes goes through a write (lib/gateway.ts), and every change someone else
 * makes for them arrives as a live ping (lib/live.ts, SyncProvider). So an
 * answer is reused while it is under FRESH_FOR_MS old and no write, ping or
 * sign-in has happened since. After any of those, or half a minute, the
 * server is asked again, exactly as before.
 *
 * No React Native imports on purpose, so this can be tested from Node.
 */
export const FRESH_FOR_MS = 30_000;

/**
 * Reads the app must never answer from anything it remembers (plan task 3.5b,
 * layer E): money, balances, escrow, payouts, fees, task status, offers, chat,
 * contacts, sign-in and age state, admin numbers. These always ask the server
 * again, whatever the 30-second rule says. Every write is never reused either
 * (writes never pass through the reuse helpers).
 *
 * A closed list: `supabase/functions/api/contract.test.ts` fails if an op is here
 * and on the server's shared list (`PUBLIC_MEMO_OPS`), or if a new `api` op is in
 * none of the lists.
 */
export const NEVER_REUSE: ReadonlySet<string> = new Set([
  // money
  'getWallet', 'getEscrowHeld', 'listWalletActivity', 'listPayouts', 'listPayoutDestinations',
  'feesSince', 'platformFees', 'settleClearedEarnings', 'myStats', 'listPromotions',
  // task status and offers
  'getTask', 'getTaskDetail', 'canQuoteOn', 'getMyBid', 'listBidsForTask', 'listMyBids', 'getProof',
  // chat and contacts
  'listMessages', 'listThreads', 'listCrewMessages', 'taskContactPhone', 'getNotification',
  // City Hunt finds: what unlocks, and whether a find was accepted (money)
  'huntFinds',
  // people map (migration 159): a spot and a consent choice are never shown from a stale copy
  'mapPeople', 'mapSharing',
  // account state and admin numbers
  'accountDeletionCheck', 'ageStatus', 'isAdmin', 'platformStats',
]);

/**
 * Reads about the caller, or whose answer depends on who is asking (row rules,
 * blocked people), that may keep today's per-person 30-second rule (decision 5).
 * They are never shared between people and never kept across a sign-in or
 * sign-out. Listed so that every `api` read is a conscious choice: shared
 * (`PUBLIC_MEMO_OPS`), never reused (`NEVER_REUSE`), or this.
 */
export const PER_PERSON_REUSE: ReadonlySet<string> = new Set([
  // feeds and task lists (row rules and blocked people make them per person)
  'listOpenTasks', 'listMyTasks', 'listMyAssignments', 'countBidsByTask', 'searchTasks', 'attachPosters',
  'searchTasksWithPosters', 'getPosterStats', 'promotableTasks', 'recommendedTasks', 'remoteTasks',
  'tasksNear', 'urgentTasks', 'listSavedTaskIds', 'listSavedTasks', 'listTaskQuestions', 'nearbyPulse',
  // people and profiles
  'listBlockedUsers', 'getProfile', 'usernameAvailable', 'listActiveWorkers', 'workersNear',
  'workerServices', 'listReviewsAbout', 'publicProfileStats', 'crewOverview', 'workerProofPhotos',
  'myStreaks', 'myRegulars', 'countMyReferrals', 'huntCounts',
  // disputes, support, feedback
  'listMyDisputes', 'listDisputeReasons', 'listTickets', 'getTicket', 'listFeedbackBoard', 'getFeedbackPost',
  // counts and notifications
  'countNeedsAttention', 'countUnreadFor', 'listNotifications', 'countUnreadNotifications', 'notificationSides',
  // signed photo links (kept per person, H69)
  'signMedia',
]);

let changes = 0;

/** Something may have changed: this person wrote, the server pinged, or someone signed in or out. */
export function noteChange(): void {
  changes += 1;
}

/** When something was read, and how many changes the app had seen by then. */
export type Stamp = { at: number; changes: number };

export function stamp(now = Date.now()): Stamp {
  return { at: now, changes };
}

/** Read under FRESH_FOR_MS ago, with no change since. */
export function isFresh(s: Stamp | null | undefined, now = Date.now()): boolean {
  if (!s || s.changes !== changes) return false;
  const age = now - s.at;
  return age >= 0 && age < FRESH_FOR_MS;
}

// ------------------------------------------------ who the memories belong to --
//
// Plan task 3.5b, layer A (hole H69): everything the app remembers belongs to one person. Every key
// starts with the signed-in person's id, or GUEST with no session, and every memory is emptied (not only
// made stale) when that changes: sign-in, sign-out, a switch to another account, an account deletion.
// Until the first session is known, nothing is remembered at all.

/** The key prefix with no session (a guest, or signed out). Never a real id: those are uuids. */
export const GUEST = 'guest';

/** The person every memory belongs to right now; undefined until the first session is known. */
let person: string | undefined;

/** How many times every memory has been emptied: an answer that arrives after a wipe is not kept. */
let wipes = 0;

const forgetters = new Set<() => void>();

/** Empty every memory the app keeps (this file's, and each one registered with onForget). */
export function forgetEverything(): void {
  wipes += 1;
  changes += 1;
  recent.clear();
  for (const fn of [...forgetters]) fn();
}

/** Another memory (signed photo links, lib/signedLinks.ts) to empty whenever this one is. */
export function onForget(fn: () => void): () => void {
  forgetters.add(fn);
  return () => forgetters.delete(fn);
}

/**
 * The session changed (lib/gateway.ts listens to every auth event, token renewals included). A different
 * person, or none, empties every memory before anything can be read under the new key.
 */
export function setPerson(id: string | null | undefined): void {
  const next = id || GUEST;
  if (next === person) return;
  person = next;
  forgetEverything();
}

/** The key prefix for what is remembered now, or null while nobody is known yet (then nothing is kept). */
export function personKey(): string | null {
  return person ?? null;
}

/** The wipe count, so an answer started before a wipe can tell it must not be kept. */
export function wipeCount(): number {
  return wipes;
}

/** Screens that always ask again when shown, whatever the 30-second rule says: the wallet (3.5b). */
const ALWAYS_ASK_SCREENS: ReadonlySet<string> = new Set(['wallet']);

/** Whether coming back to `screen` may skip asking again while it is fresh. */
export function screenMayReuse(screen: string | null | undefined): boolean {
  return !screen || !ALWAYS_ASK_SCREENS.has(screen);
}

type Remembered = { stamp: Stamp; answer: Promise<unknown>; /** set on shared (same-for-everyone) answers: how long they may stand */ ttlMs?: number };
const recent = new Map<string, Remembered>();

/** How many answers are remembered (for tests). */
export function rememberedCount(): number {
  return recent.size;
}

/**
 * The last answer to `op` with `args` for the signed-in person while it is fresh, otherwise a new one
 * from `ask`. The key is `<person or guest>:op:args`. Only ops on PER_PERSON_REUSE are ever kept: an op on
 * NEVER_REUSE (or on no list) always asks, as does any read before the first session is known. A failed
 * ask is never kept.
 */
export function reuseWhileFresh<T>(op: string, args: string, ask: () => Promise<T>, now = Date.now()): Promise<T> {
  const who = person;
  if (who === undefined || NEVER_REUSE.has(op) || !PER_PERSON_REUSE.has(op)) return ask();
  const key = `${who}:${op}:${args}`;
  const hit = recent.get(key);
  if (hit && isFresh(hit.stamp, now)) return hit.answer as Promise<T>;
  const answer = ask();
  const entry = { stamp: stamp(now), answer };
  recent.set(key, entry);
  answer.catch(() => {
    if (recent.get(key) === entry) recent.delete(key);
  });
  return answer;
}

// ------------------------------------------- same-for-everyone reads (3.5b, layer A) --
//
// The five reads whose answer is the same for every person (the server's PUBLIC_MEMO_OPS, in
// supabase/functions/api/publicMemo.ts) may be kept for the same short time the server keeps them, but only
// while the admin switch "public cache: app" (features.publicCache in lib/appConfig.ts) is on. Off, nothing
// here is kept and every read asks the server exactly as before. They are still keyed per person and emptied
// with everything else on sign-in, sign-out or an account switch; a write or a ping does not matter to them
// (nothing this person does changes what everyone sees within these seconds, and the server shares the
// same copy for as long anyway). The closed list is checked against the server's by freshness.test.ts.

/** Op -> how long the app may reuse its answer. Never longer than the server's own time for the op. */
export const PUBLIC_REUSE_MS: Readonly<Record<string, number>> = Object.freeze({
  trendingCategories: 60_000,
  topEarners: 60_000,
  platformHighlights: 30_000,
  promotionTiers: 60_000,
  adAuctionRanks: 15_000,
});

let publicCacheOn = false;

/** The admin switch "public cache: app" (appConfig.ts calls this with every answer). Turning it off forgets what was kept. */
export function setPublicCache(on: boolean): void {
  const next = on === true;
  if (next === publicCacheOn) return;
  publicCacheOn = next;
  if (!next) for (const [k, v] of [...recent]) if (v.ttlMs !== undefined) recent.delete(k);
}

export function publicCacheEnabled(): boolean {
  return publicCacheOn;
}

/** A real answer worth keeping: not nothing, and not an empty list or object (that looks like a fallback, and re-asking costs the same as today). */
function worthKeeping(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v as object).length > 0;
  return true;
}

/**
 * Like reuseWhileFresh, for the ops in PUBLIC_REUSE_MS only, and only while the switch is on. `ask` must be the
 * raw call that throws when it fails: a failed answer, an empty one, one that arrives after a wipe, and any
 * read before the first session is known are never kept. An op on NEVER_REUSE or on no list always asks.
 */
export function reusePublic<T>(op: string, args: string, ask: () => Promise<T>, now = Date.now()): Promise<T> {
  const who = person;
  const ttlMs = Object.prototype.hasOwnProperty.call(PUBLIC_REUSE_MS, op) ? PUBLIC_REUSE_MS[op] : undefined;
  if (!publicCacheOn || who === undefined || ttlMs === undefined || NEVER_REUSE.has(op)) return ask();
  const key = `${who}:${op}:${args}`;
  const hit = recent.get(key);
  if (hit && hit.ttlMs !== undefined) {
    const age = now - hit.stamp.at;
    if (age >= 0 && age < hit.ttlMs) return hit.answer as Promise<T>;
  }
  const answer = ask();
  const entry: Remembered = { stamp: { at: now, changes }, answer, ttlMs };
  recent.set(key, entry);
  answer.then(
    (v) => {
      if (!worthKeeping(v) && recent.get(key) === entry) recent.delete(key);
    },
    () => {
      if (recent.get(key) === entry) recent.delete(key);
    },
  );
  return answer;
}
