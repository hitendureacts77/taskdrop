/**
 * City Hunt (design D19): the pure parts, tested in Node (hunt.test.ts).
 *
 * A Hunt is a normal request with Hunt switched on: many people look, each sends
 * a find, and the poster pays only the find they accept. Every rule is decided
 * on the server (migration 158); these helpers only word and show what it says.
 *
 * No React Native imports on purpose.
 */

export type HuntWindow = '2h' | 'today' | '3d';
export type HuntNeed = 'photo' | 'place' | 'pin' | 'price';
export type HuntDeclineReason = 'not_it' | 'gone' | 'too_far' | 'other';

export const HUNT_WINDOWS: { key: HuntWindow; label: string }[] = [
  { key: '2h', label: '2 hours' },
  { key: 'today', label: 'Today' },
  { key: '3d', label: '3 days' },
];

export const HUNT_NEEDS: { key: HuntNeed; label: string; missing: string }[] = [
  { key: 'photo', label: 'Photo taken now', missing: 'photo' },
  { key: 'place', label: 'Shop name', missing: 'shop name' },
  { key: 'pin', label: 'Pin on map', missing: 'pin' },
  { key: 'price', label: 'Price', missing: 'price' },
];

export const HUNT_DECLINE_REASONS: { key: HuntDeclineReason; label: string }[] = [
  { key: 'not_it', label: 'Not what I asked for' },
  { key: 'gone', label: 'Out of stock / gone' },
  { key: 'too_far', label: 'Too far' },
  { key: 'other', label: 'Other' },
];

/** Most finds one person may send on one Hunt (the server says the same). */
export const MAX_FINDS_PER_HUNT = 3;
/** How long after a Hunt stops taking finds the poster can still accept one. */
export const ACCEPT_GRACE_MS = 24 * 3600_000;

/** The Hunt choice the writer starts with: photo, name and pin at a place; photo and name online. */
export function defaultNeeds(remote: boolean): HuntNeed[] {
  return remote ? ['photo', 'place'] : ['photo', 'place', 'pin'];
}

/** A pin means nothing for remote work, so it is dropped there. */
export function needsFor(needs: HuntNeed[], remote: boolean): HuntNeed[] {
  const out = HUNT_NEEDS.map((n) => n.key).filter((k) => needs.includes(k) && !(remote && k === 'pin'));
  return out.length ? out : defaultNeeds(remote);
}

/** Where a Hunt stands, from its times: taking finds, waiting for the poster, or ended. */
export type HuntPhase = 'live' | 'reviewing' | 'ended';

export function huntPhase(
  task: { hunt_until: string | null | undefined; status: string },
  now: number = Date.now(),
): HuntPhase | null {
  if (!task.hunt_until) return null;
  if (task.status !== 'OPEN') return 'ended';
  const until = new Date(task.hunt_until).getTime();
  if (!Number.isFinite(until)) return 'ended';
  if (now < until) return 'live';
  if (now < until + ACCEPT_GRACE_MS) return 'reviewing';
  return 'ended';
}

export const isHunt = (task: { hunt_until?: string | null } | null | undefined): boolean => Boolean(task?.hunt_until);

/** "1 h 12 m left", "45 m left", "2 days left"; "Ended" once it is over. */
export function huntTimeLeft(untilIso: string | null | undefined, now: number = Date.now()): string {
  if (!untilIso) return '';
  const ms = new Date(untilIso).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'Ended';
  const mins = Math.max(1, Math.floor(ms / 60_000));
  if (mins < 60) return `${mins} m left`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const rest = mins % 60;
    return rest ? `${hours} h ${rest} m left` : `${hours} h left`;
  }
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day left' : `${days} days left`;
}

/** "7 people looking · 3 finds sent". */
export function huntCountsText(lookers: number, finds: number): string {
  const a = lookers === 1 ? '1 person looking' : `${lookers} people looking`;
  const b = finds === 1 ? '1 find sent' : `${finds} finds sent`;
  return `${a} · ${b}`;
}

/** The proof flags a find carries (what the poster may see before accepting). */
export type FindFlags = { has_photo: boolean; has_place: boolean; has_pin: boolean; has_price: boolean };

const HAS: Record<HuntNeed, keyof FindFlags> = { photo: 'has_photo', place: 'has_place', pin: 'has_pin', price: 'has_price' };

/** The parts the poster asked for that this find lacks, in the order they were offered. */
export function missingParts(find: FindFlags, needs: readonly string[] | null | undefined): HuntNeed[] {
  const asked = new Set(needs ?? []);
  return HUNT_NEEDS.map((n) => n.key).filter((k) => asked.has(k) && !find[HAS[k]]);
}

/** Every part the find carries, plus each asked-for part it lacks, for the "✓ Pin  ✕ Shop name missing" line. */
export function proofChecks(find: FindFlags, needs: readonly string[] | null | undefined): { label: string; ok: boolean }[] {
  const asked = new Set(needs ?? []);
  return HUNT_NEEDS.filter((n) => find[HAS[n.key]] || asked.has(n.key)).map((n) => ({
    label: find[HAS[n.key]] ? n.label : `${n.label} missing`,
    ok: find[HAS[n.key]],
  }));
}

/** What the poster's main button on a find says: accept, or ask for the first missing part. */
export function findAction(
  find: FindFlags & { asked_part: string | null },
  needs: readonly string[] | null | undefined,
  rewardText: string,
): { kind: 'accept'; label: string } | { kind: 'ask'; part: HuntNeed; label: string } {
  const missing = missingParts(find, needs);
  if (missing.length && !find.asked_part) {
    const part = missing[0]!;
    return { kind: 'ask', part, label: `Ask for the ${HUNT_NEEDS.find((n) => n.key === part)!.missing}` };
  }
  return { kind: 'accept', label: `This is it · pay ${rewardText}` };
}

/** "0.8 km away", "< 0.1 km away", or null when either side has no place. */
export function findDistanceText(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 0.1) return '< 0.1 km away';
  return `${km.toFixed(1)} km away`;
}

/**
 * A find row as the server sent it can only carry the locked fields once it is
 * unlocked (accepted, or the caller's own). This drops them otherwise, so a
 * screen can never show what it was not meant to have.
 */
export function visibleFind<T extends { unlocked: boolean; photo_path: string | null; place_name: string | null; lat: number | null; lng: number | null; price_note: string | null; note: string | null }>(
  f: T,
): T {
  if (f.unlocked) return f;
  return { ...f, photo_path: null, place_name: null, lat: null, lng: null, price_note: null, note: null };
}

/** A map link for an unlocked pin. */
export function pinLink(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
