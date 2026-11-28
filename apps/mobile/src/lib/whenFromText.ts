import type { WhenKey } from './taskBrief';

/**
 * Which "when" choice a request already names: today, tomorrow (the 2 days choice is the
 * closest) or this weekend. Simple English, plus a few Hindi and Telugu words in English
 * letters. The earliest word wins. Null when the text names no day.
 */
const WORDS: { key: WhenKey; re: RegExp }[] = [
  { key: 'weekend', re: /\b(this weekend|weekends?|saturday|sunday|shaniwar|ravivar|shanivaram|aadivaram)\b/ },
  { key: '2days', re: /\b(tomorrow|tmrw|tomorow|kal|repu)\b/ },
  { key: 'today', re: /\b(today|tonight|this evening|this afternoon|aaj|ee roju)\b/ },
];

export function whenFromText(text: string): WhenKey | null {
  const t = text.toLowerCase();
  let best: { key: WhenKey; at: number } | null = null;
  for (const { key, re } of WORDS) {
    const m = re.exec(t);
    if (m && (!best || m.index < best.at)) best = { key, at: m.index };
  }
  return best?.key ?? null;
}
