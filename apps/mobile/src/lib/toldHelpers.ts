/**
 * "Who can see my new task" (board fix, 28 Nov). Pure helpers over the helpers-near list the map already uses
 * (workersNear), so the number on the task page is a real count and never a guess. Helpers who list the task's
 * category (as a skill, or as an open service) are counted; a task with no category counts every nearby helper.
 */

export const TOLD_RADIUS_KM = 10;
/** Ask for this many; a result this long means "at least". */
export const TOLD_LIMIT = 100;

type Helper = {
  skills?: string[] | null;
  top_service?: { category: string | null } | null;
};

const norm = (s: string) => s.trim().toLowerCase();

/** Does this helper do this kind of work? Skill or service category, either way round ("Plumbing" / "plumber"). */
export function helperDoes(h: Helper, category: string | null | undefined): boolean {
  if (!category || !category.trim()) return true;
  const want = norm(category);
  const have = [...(h.skills ?? []), h.top_service?.category ?? ''].map(norm).filter(Boolean);
  return have.some((s) => s === want || s.includes(want) || want.includes(s));
}

export type ToldHelpers = { count: number; atLeast: boolean };

export function countToldHelpers(helpers: Helper[], category: string | null | undefined): ToldHelpers {
  const count = helpers.filter((h) => helperDoes(h, category)).length;
  return { count, atLeast: helpers.length >= TOLD_LIMIT };
}

/** The line under "Waiting for offers". Plain words; a zero is said kindly. */
export function toldLine(told: ToldHelpers, area: string | null, category: string | null | undefined): string {
  const where = area ? ` near ${area}` : ' near you';
  const what = category && category.trim() ? ` who do ${category.trim().toLowerCase()}` : '';
  if (told.count === 0) return `No helpers${where}${what} yet. Share your task to bring some in.`;
  const n = told.atLeast ? `${told.count}+` : String(told.count);
  return `${n} ${told.count === 1 && !told.atLeast ? 'helper' : 'helpers'}${where}${what} can see your task. Most offers come within an hour.`;
}
