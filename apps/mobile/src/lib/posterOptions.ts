/**
 * Which options to suggest while posting (owner, 2026-11-01).
 *
 * Every option is something the poster switches on themselves; these rules
 * only pick the few worth showing first, each with the reason in the poster's
 * own words. Nothing here turns anything on. Pure functions, so they are
 * tested in Node (posterOptions.test.ts).
 */

export type OptionKey = 'flash' | 'crew' | 'regular' | 'repeat' | 'photos' | 'liveAnswer';

export type Suggestion = { key: OptionKey; reason: string };

export type SuggestInput = {
  /** What the poster typed, and the title the writer made of it. */
  text: string;
  /** "Now" on the When step. */
  whenNow: boolean;
  remote: boolean;
  /** How many tasks in this category the poster posted before. */
  postedBefore: number;
  /** Someone the poster hired for this kind of job before. */
  regular: { id: string; name: string } | null;
};

/** At most this many, so the step never feels like a form. */
export const MAX_SUGGESTIONS = 3;

const CREW = /\b(shift(?:ing)?|mov(?:e|ing)|relocat\w*|packers?|movers?|event|party|wedding|function|deep[- ]?clean\w*|whole (?:house|flat|home)|[1-5]\s?bhk)\b/i;
const PHOTOS = /\b(clean\w*|paint\w*|repair\w*|fix\w*|polish\w*|wash\w*|til(?:e|es|ing)|plumb\w*|garden\w*)\b/i;
const OFTEN = /\b(water cans?|groceries|milk|laundry|ironing|cook(?:ing)?|weekly|every (?:day|week|month|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i;

const quoted = (m: RegExpMatchArray | null) => (m ? `You said “${m[0].trim()}”` : '');

/** The options worth suggesting for this task, most useful first. */
export function suggestOptions(i: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];
  if (i.whenNow && !i.remote) out.push({ key: 'flash', reason: 'You picked “Now” on the When step' });
  const crew = i.remote ? null : i.text.match(CREW);
  if (crew) out.push({ key: 'crew', reason: quoted(crew) });
  if (i.regular) out.push({ key: 'regular', reason: `You hired ${i.regular.name} for this before` });
  if (i.postedBefore > 0) {
    out.push({
      key: 'repeat',
      reason: `You posted this ${i.postedBefore === 1 ? 'once' : `${i.postedBefore} times`} before`,
    });
  } else if (OFTEN.test(i.text)) {
    out.push({ key: 'repeat', reason: 'This sounds like something you need often' });
  }
  const photos = i.remote ? null : i.text.match(PHOTOS);
  if (photos) out.push({ key: 'photos', reason: quoted(photos) });
  return out.slice(0, MAX_SUGGESTIONS);
}

const QUESTION = /^(is|are|how|what|does|do|did|has|have|any|anyone|can someone|could someone|check (?:if|whether))\b|\?\s*$/i;
const RIGHT_NOW = /\b(queue|line|crowd(?:ed)?|rush|open|closed|available|in stock|stock|traffic|waiting|right now|currently|now|today)\b/i;

/**
 * A quick question about a place right now ("is the queue long", "is the shop
 * open"): the Ask step offers to post it as a Live answer instead.
 */
export function looksLikePlaceQuestion(text: string): boolean {
  const t = text.trim();
  return t.length >= 8 && QUESTION.test(t) && RIGHT_NOW.test(t);
}

/** Each helper's share of a crew budget, in paise: floor, like the server. */
export const crewShareMinor = (totalMinor: number, size: number) => Math.floor(totalMinor / Math.max(1, size));
