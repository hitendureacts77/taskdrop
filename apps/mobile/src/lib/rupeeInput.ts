/**
 * The whole-rupee digits in what a person typed into a rupee field (B167).
 *
 * Every rupee box in the app takes whole rupees only. Stripping every
 * non-digit used to turn "250.50" into 25050, a price 100 times too high, and
 * "2.5" km into 25. So the paise (anything after the first point) are dropped
 * first, then the commas, spaces and ₹ sign Indians type are removed.
 */
export function wholeDigits(text: string, maxLength?: number): string {
  const whole = text.split('.')[0] ?? '';
  const digits = whole.replace(/[^0-9]/g, '');
  return maxLength === undefined ? digits : digits.slice(0, maxLength);
}

/**
 * What a whole-rupee box keeps on screen while someone types (B167 recheck).
 *
 * The boxes are controlled: the text shown is rebuilt from what we store. If
 * the point is dropped on every key, "250" + "." shows "250" again and the next
 * key turns it into "2505". So the first point stays on screen and every key
 * after it is ignored: typing 250.50 shows "250." and means ₹250.
 */
export function wholeText(text: string, maxLength?: number): string {
  const dot = text.indexOf('.');
  const whole = wholeDigits(dot === -1 ? text : text.slice(0, dot), maxLength);
  return dot === -1 || whole === '' ? whole : `${whole}.`;
}

/** Types every key of `typed` into a controlled box that stores `keep(text)`, like a person would. */
export function typeInto(typed: string, keep: (text: string) => string): string {
  let shown = '';
  for (const key of typed) shown = keep(shown + key);
  return shown;
}
