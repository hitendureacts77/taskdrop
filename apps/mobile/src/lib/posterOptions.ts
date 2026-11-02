/**
 * Which options to suggest while posting (owner, 2026-11-01).
 *
 * Every option is something the poster switches on themselves; these rules
 * only pick the one worth showing first, with the reason in the poster's own
 * words. Nothing here turns anything on. Pure functions, so they are tested in
 * Node (posterOptions.test.ts).
 *
 * Owner, 2026-11-02: one suggestion only, from the post's details; Repeat,
 * Offer-first and Before-and-after photos are no longer offered while posting.
 * The keys stay so "Book again" and older tasks keep working.
 */

export type OptionKey = 'flash' | 'crew' | 'regular' | 'repeat' | 'photos' | 'liveAnswer';

export type Suggestion = { key: OptionKey; reason: string };

export type SuggestInput = {
  /** What the poster typed, and the title the writer made of it. */
  text: string;
  /** "Now" on the When step. */
  whenNow: boolean;
  remote: boolean;
};

/** One, so the step never feels like a form. */
export const MAX_SUGGESTIONS = 1;

const CREW = /\b(shift(?:ing)?|mov(?:e|ing)|relocat\w*|packers?|movers?|event|party|wedding|function|deep[- ]?clean\w*|whole (?:house|flat|home)|[1-5]\s?bhk)\b/i;

const quoted = (m: RegExpMatchArray | null) => (m ? `You said “${m[0].trim()}”` : '');

/**
 * The option worth suggesting for this task, if any. What the poster wrote
 * comes first (a crew job), then the When step ("Now" → Flash Drop).
 */
export function suggestOptions(i: SuggestInput): Suggestion[] {
  const out: Suggestion[] = [];
  const crew = i.remote ? null : i.text.match(CREW);
  if (crew) out.push({ key: 'crew', reason: quoted(crew) });
  if (i.whenNow && !i.remote) out.push({ key: 'flash', reason: 'You picked “Now” on the When step' });
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

/** A crew is 2 to 10 helpers, like the server. */
export const CREW_MAX = 10;

const WORD_COUNTS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const HEADCOUNT = /\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|persons|helpers|workers|men|guys|labou?rers|hands)\b/i;

/** How many helpers to start the crew with: the number the poster wrote ("3 people"), else 2. */
export function crewSizeFrom(text: string): number {
  const m = text.match(HEADCOUNT);
  const n = m ? (WORD_COUNTS[m[1]!.toLowerCase()] ?? Number(m[1])) : 2;
  return Math.min(CREW_MAX, Math.max(2, n));
}

/** Each helper's share of a crew budget, in paise: floor, like the server. */
export const crewShareMinor = (totalMinor: number, size: number) => Math.floor(totalMinor / Math.max(1, size));
