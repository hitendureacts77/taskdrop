/**
 * What was typed into the weekly goal box (W3-15). "-5" used to be saved as ₹5 (the minus was dropped without
 * a word). Anything that is not a plain amount is refused with a message; an empty box clears the goal.
 * Pure, tested in Node (goalText.test.ts).
 */
export const MAX_GOAL_INR = 1_000_000; // the server accepts up to 10,00,00,000 paise

export type GoalInput = { ok: true; minor: number | null } | { ok: false; message: string };

export function parseGoalText(text: string): GoalInput {
  const raw = text.trim();
  if (raw === '') return { ok: true, minor: null };
  // Only digits, with the commas, spaces and ₹ Indians type; a minus or any letter is not an amount.
  if (!/^[₹\s,]*\d[\d,\s]*(\.\d*)?$/.test(raw)) return { ok: false, message: 'Type your goal as a plain amount, like 2000' };
  const rupees = Number((raw.split('.')[0] ?? '').replace(/[^0-9]/g, ''));
  if (!(rupees > 0)) return { ok: false, message: 'The goal must be more than ₹0. Leave the box empty to clear it' };
  if (rupees > MAX_GOAL_INR) return { ok: false, message: 'The most is ₹10,00,000' };
  return { ok: true, minor: rupees * 100 };
}
