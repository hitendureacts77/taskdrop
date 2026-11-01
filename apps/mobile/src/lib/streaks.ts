/**
 * Badges and the weekly goal for the Earn side's Streaks screen. The counts
 * come from my_streaks() (migration 134); which badge each count earns lives
 * here, so the rules are tested in Node (streaks.test.ts).
 */
import type { Streaks } from '../data/api';

export type Badge = {
  key: string;
  name: string;
  /** What it took, or how far is left. */
  hint: string;
  earned: boolean;
  /** 'earn' badges are blue, 'gold' ones are the few rarer ones. */
  tone: 'earn' | 'gold';
};

/** The on-time streak that earns its badge. */
export const STREAK_GOAL = 10;

const left = (n: number, unit: string) => `${n} more ${unit}${n === 1 ? '' : 's'}`;

function badge(key: string, name: string, have: number, need: number, done: string, unit: string, tone: Badge['tone'] = 'earn'): Badge {
  const earned = have >= need;
  return { key, name, earned, tone, hint: earned ? done : left(need - have, unit) };
}

export function badgesFor(s: Streaks): Badge[] {
  return [
    badge('early', 'Early bird', s.earlyStarts, 1, 'Started before 8 am', 'early start'),
    badge('five', 'Five stars', s.fiveStars, 5, 'Five 5-star reviews', '5-star review', 'gold'),
    badge('ten', 'First 10', s.jobsDone, 10, '10 jobs done', 'job'),
    badge('ontime', `On time x${STREAK_GOAL}`, s.onTimeStreak, STREAK_GOAL, `${STREAK_GOAL} on time in a row`, 'on-time job'),
    badge('crew', 'Crew member', s.crewJobs, 1, 'Worked in a crew', 'crew job'),
    badge('live', 'Eyes on the ground', s.liveAnswers, 5, '5 live answers', 'live answer'),
    badge('photos', 'Proof pro', s.photoJobs, 5, '5 jobs with photos', 'photo job'),
    badge('fifty', '50 jobs', s.jobsDone, 50, '50 jobs done', 'job', 'gold'),
  ];
}

/** How far into the weekly goal, 0 to 1, and what is left. Null without a goal. */
export function goalProgress(s: Pick<Streaks, 'weekEarnedMinor' | 'weeklyGoalMinor'>): { share: number; toGoMinor: number } | null {
  if (!s.weeklyGoalMinor || s.weeklyGoalMinor <= 0) return null;
  return {
    share: Math.min(1, Math.max(0, s.weekEarnedMinor / s.weeklyGoalMinor)),
    toGoMinor: Math.max(0, s.weeklyGoalMinor - s.weekEarnedMinor),
  };
}

/** Whole days left in the week that started at `weekStart` (Monday, India time). */
export function daysLeftInWeek(weekStart: string, now: Date = new Date()): number {
  const end = new Date(weekStart).getTime() + 7 * 86_400_000;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}
