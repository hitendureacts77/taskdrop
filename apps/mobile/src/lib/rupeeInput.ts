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
