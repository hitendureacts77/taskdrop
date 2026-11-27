/**
 * Home's live words and Earn Home's one jobs list (task 1.19 F, decisions 5 and the live pill). Pure: no network,
 * no React, so the choices are unit-tested (homeJobs.test.ts).
 */

/** The chips of Earn Home's "Jobs for you": each shows one of the lists Home already reads. */
export type JobsChip = 'you' | 'near' | 'remote' | 'today';

export const JOB_CHIPS: { key: JobsChip; label: string }[] = [
  { key: 'you', label: 'For you' },
  { key: 'near', label: 'Near you' },
  { key: 'remote', label: 'Remote' },
  { key: 'today', label: 'Today' },
];

/**
 * Decision 5: a worker with no skills yet has nothing for "For you" to match, so the list opens on "Near you" (with
 * the radius); once they have added a skill it opens on "For you".
 */
export function firstJobsChip(skills: readonly string[] | null | undefined): JobsChip {
  return (skills ?? []).some((s) => s.trim().length > 0) ? 'you' : 'near';
}

/** The chip on screen: the one they tapped, else the first one for their skills (skills load after the first draw). */
export function shownJobsChip(picked: JobsChip | null, skills: readonly string[] | null | undefined): JobsChip {
  return picked ?? firstJobsChip(skills);
}

/**
 * The live pill in Hire Home's area row, from the nearby pulse (helpers active now, tasks done today). A part that
 * is zero is left out; with nothing to count the pill still opens the live sheet, so it says so plainly.
 */
export function livePillText(pulse: { doneToday: number; activeNow: number } | null | undefined): string {
  const active = pulse?.activeNow ?? 0;
  const done = pulse?.doneToday ?? 0;
  if (active > 0) return `${active} ${active === 1 ? 'helper' : 'helpers'} active now`;
  if (done > 0) return `${done} done near you today`;
  return 'Live near you';
}

/** Earn Home's pill: open jobs in the radius, "30+" once the read hit its limit. Null before the list is read. */
export function openNearText(count: number | null, limit: number): string | null {
  if (count === null) return null;
  if (count <= 0) return 'No jobs near you yet';
  return `${count >= limit ? `${limit}+` : count} open near you`;
}

/**
 * The cards a chip shows: the first few, or all of them once "Show N more" is open. `extra` is how many sit past the
 * first few (0: no button at all), so nothing in the list is ever out of reach.
 */
export function firstOf<T>(rows: readonly T[], first: number, open: boolean): { shown: T[]; extra: number } {
  const extra = Math.max(0, rows.length - first);
  return { shown: open || extra === 0 ? [...rows] : rows.slice(0, first), extra };
}
