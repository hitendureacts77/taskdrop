import type { Profile } from '../data/api';

/**
 * Worker levels and profile strength.
 *
 * Both are derived from data TaskDrop already has -- finished jobs, ratings,
 * and which profile fields are filled in -- so nothing here can be claimed
 * without being true. Levels are a progress signal only; they change no fees.
 */

export type Level = { index: number; name: string; jobs: number; rating: number };

export const LEVELS: Level[] = [
  { index: 1, name: 'Starter', jobs: 0, rating: 0 },
  { index: 2, name: 'Trusted', jobs: 5, rating: 4.0 },
  { index: 3, name: 'Pro', jobs: 20, rating: 4.5 },
  { index: 4, name: 'Top Dropper', jobs: 50, rating: 4.7 },
];

export type LevelStatus = Level & {
  next: Level | null;
  /** 0..1 towards the next level, by jobs. */
  progress: number;
  jobsToGo: number;
  ratingShort: boolean;
};

export function levelFor(jobsDone: number, rating: number): LevelStatus {
  let current = LEVELS[0]!;
  for (const l of LEVELS) {
    if (jobsDone >= l.jobs && (l.rating === 0 || rating >= l.rating)) current = l;
  }
  const next = LEVELS.find((l) => l.index === current.index + 1) ?? null;
  const span = next ? next.jobs - current.jobs : 1;
  const progress = next ? Math.max(0, Math.min(1, (jobsDone - current.jobs) / span)) : 1;
  return {
    ...current,
    next,
    progress,
    jobsToGo: next ? Math.max(0, next.jobs - jobsDone) : 0,
    ratingShort: next ? rating < next.rating : false,
  };
}

export type StrengthItem = { label: string; done: boolean; points: number };
export type Strength = {
  score: number;
  sections: { label: string; got: number; max: number }[];
  todo: StrengthItem[];
};

export function profileStrength(
  p: Profile | null,
  v: { phone: boolean; email: boolean },
  reviews: number,
): Strength {
  const words = (p?.bio ?? '').trim().split(/\s+/).filter(Boolean).length;
  const basic: StrengthItem[] = [
    { label: 'Add your name', done: Boolean(p?.display_name?.trim()), points: 10 },
    { label: 'Add a profile photo', done: Boolean(p?.avatar_url), points: 10 },
    { label: 'Set your location', done: Boolean(p?.loc_label), points: 10 },
  ];
  const pro: StrengthItem[] = [
    { label: 'Write a bio of at least 50 words', done: words >= 50, points: 15 },
    { label: 'Add at least 3 skills', done: (p?.skills?.length ?? 0) >= 3, points: 15 },
    { label: 'Add the languages you speak', done: (p?.languages?.length ?? 0) > 0, points: 10 },
  ];
  const trust: StrengthItem[] = [
    { label: 'Verify your phone or email', done: v.phone || v.email, points: 15 },
    { label: 'Pick a username', done: Boolean(p?.username), points: 5 },
    { label: 'Get your first review', done: reviews > 0, points: 10 },
  ];
  const sum = (xs: StrengthItem[]) => xs.reduce((n, x) => n + (x.done ? x.points : 0), 0);
  const max = (xs: StrengthItem[]) => xs.reduce((n, x) => n + x.points, 0);
  const sections = [
    { label: 'About you', got: sum(basic), max: max(basic) },
    { label: 'Your work', got: sum(pro), max: max(pro) },
    { label: 'Trust', got: sum(trust), max: max(trust) },
  ];
  return {
    score: sections.reduce((n, s) => n + s.got, 0),
    sections,
    todo: [...basic, ...pro, ...trust].filter((x) => !x.done),
  };
}
