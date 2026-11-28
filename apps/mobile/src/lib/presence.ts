/**
 * Presence, the way a chat app shows it: someone with TaskDrop open is
 * "Active now"; otherwise they are away, for however long it has been.
 *
 * The app writes profiles.last_seen_at every minute while it is open and in
 * front (see PresenceBeat), so "within the last few minutes" means open now.
 */

/** Seen this recently counts as active: two missed beats of slack. */
export const ACTIVE_WINDOW_MS = 3 * 60_000;

export type Presence = { online: boolean; label: string };

export function presenceOf(lastSeen: string | null | undefined, now = Date.now()): Presence {
  if (!lastSeen) return { online: false, label: 'Not active yet' };
  const ms = now - new Date(lastSeen).getTime();
  if (ms < ACTIVE_WINDOW_MS) return { online: true, label: 'Active now' };
  const min = Math.round(ms / 60_000);
  if (min < 60) return { online: false, label: `Away · ${min} min` };
  const h = Math.floor(min / 60);
  if (h < 24) return { online: false, label: min % 60 ? `Away · ${h}h ${min % 60}m` : `Away · ${h}h` };
  const d = Math.floor(h / 24);
  return { online: false, label: d === 1 ? 'Last seen yesterday' : `Last seen ${d} days ago` };
}

/** How many people are in the list, and how many of them are active now. One way of counting for every Hire Home figure. */
export function peopleCounts(list: readonly { last_seen_at?: string | null }[], now: number): { n: number; live: number } {
  return { n: list.length, live: list.filter((w) => presenceOf(w.last_seen_at, now).online).length };
}

/** The live pill's words: "1 of 12 helpers active now". Null until the read is back, or with nobody near. */
export function helpersLiveText(list: readonly { last_seen_at?: string | null }[] | null, now: number): string | null {
  if (list === null) return null;
  const { n, live } = peopleCounts(list, now);
  if (n === 0) return null;
  return `${live} of ${n} ${n === 1 ? 'helper' : 'helpers'} active now`;
}
