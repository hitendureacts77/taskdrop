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
  const h = Math.round(min / 60);
  if (h < 24) return { online: false, label: `Away · ${h} h` };
  const d = Math.round(h / 24);
  return { online: false, label: d === 1 ? 'Last seen yesterday' : `Last seen ${d} days ago` };
}
