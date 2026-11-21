import { MAX_PRICE_INR, MIN_PRICE_INR } from './limits';
import { crewShareMinor } from './posterOptions';

/**
 * The whole post, checked at once (S4-12). Each step of the writer only gates its own Continue, so a step reopened
 * from the path (or a kept post) could reach "Post my request" with an earlier step no longer valid. This says
 * which step to send the person back to, and why. The server checks all of it again.
 */
export type PostStepName = 'brief' | 'when' | 'budget' | 'providers' | 'options';

export type PostProblem = { step: PostStepName; message: string };

export function firstPostProblem(i: {
  title: string;
  description: string;
  /** The title or description holds a phone number or other contact (the shared filter decided). */
  hasContact: boolean;
  /** The poster's own amount, in rupees. */
  budget: number | null;
  /** What is posted, top-up included, in rupees. */
  price: number;
  /** At a place, with no place set. */
  noPlace: boolean;
  crewSize: number;
  whenKey: string;
  customDue: Date | null;
  now?: number;
}): PostProblem | null {
  const now = i.now ?? Date.now();
  if (i.title.trim().length < 4 || i.description.trim().length < 10) {
    return { step: 'brief', message: 'Your post needs a title and a short description first.' };
  }
  if (i.hasContact) {
    return { step: 'brief', message: 'Take the phone number or contact out of your post. Contacts unlock once work starts.' };
  }
  if (i.whenKey === 'custom' && i.customDue && i.customDue.getTime() <= now) {
    return { step: 'when', message: 'The time you picked has passed. Pick a new one.' };
  }
  if ((i.budget ?? 0) < MIN_PRICE_INR) {
    return { step: 'budget', message: `The lowest price is ₹${MIN_PRICE_INR.toLocaleString('en-IN')}.` };
  }
  if (i.price > MAX_PRICE_INR) {
    return { step: 'budget', message: `The most is ₹${MAX_PRICE_INR.toLocaleString('en-IN')}.` };
  }
  if (i.noPlace) return { step: 'providers', message: 'Set where the work is, or choose Remote.' };
  if (i.crewSize >= 2 && crewShareMinor(i.price * 100, i.crewSize) < MIN_PRICE_INR * 100) {
    return {
      step: 'options',
      message: `Each helper must get at least ₹${MIN_PRICE_INR.toLocaleString('en-IN')}. Raise the budget or ask for fewer people.`,
    };
  }
  return null;
}

/** Categories that are nearly always done online, so the Place step starts on Remote for them (L3-11). */
export const MOSTLY_REMOTE_CATEGORIES = ['Writing & Content'];
export const defaultsToRemote = (category: string) => MOSTLY_REMOTE_CATEGORIES.includes(category);

/**
 * A failure message the server wrote as a bare field name ("Invalid dueAt") turned into a sentence; anything
 * else is left as it came (it already went through the safe-wording rules).
 */
export function plainPostError(message: string): string {
  if (/^Invalid dueAt/i.test(message)) return 'The time you picked has passed. Go back and pick a new one.';
  if (/^Invalid title/i.test(message)) return 'Check the title: it needs at least 4 letters.';
  if (/^Invalid (\w+)$/i.test(message)) return 'Something in your post is not valid. Go back through the steps and check each one.';
  return message;
}

/**
 * Whether a person's own tasks in the last day already reach a daily limit that applies to new accounts (S: L1-6).
 * `created` are the creation times of the tasks; a crew counts once. The real limit stays on the server.
 */
export function postedRecently(created: { created_at: string; crew_id?: string | null; id: string }[], now = Date.now()): number {
  const day = 24 * 3600 * 1000;
  const seen = new Set<string>();
  for (const t of created) {
    if (now - new Date(t.created_at).getTime() < day) seen.add(t.crew_id ?? t.id);
  }
  return seen.size;
}


/**
 * The day a big-day line is planned for ("2026-11-22"), as the deadline the writer's When step starts on (S4-28):
 * that evening, 9 pm. Null when it is not a day, or it is today or gone by (the writer's own "Today" is right then).
 */
export function plannedDue(day: unknown, now = new Date()): Date | null {
  if (typeof day !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 21, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  const startTomorrow = new Date(now);
  startTomorrow.setHours(24, 0, 0, 0);
  return d.getTime() >= startTomorrow.getTime() ? d : null;
}
