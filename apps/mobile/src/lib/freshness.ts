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
  'myStreaks', 'myRegulars', 'countMyReferrals',
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

const recent = new Map<string, { stamp: Stamp; answer: Promise<unknown> }>();

/** The last answer for `key` while it is fresh, otherwise a new one from `ask`. A failed ask is never kept. */
export function reuseWhileFresh<T>(key: string, ask: () => Promise<T>, now = Date.now()): Promise<T> {
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
