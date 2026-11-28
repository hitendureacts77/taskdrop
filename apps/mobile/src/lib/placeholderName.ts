/**
 * A name the server or an old sign-in made up, not one the person chose: a phone number's digits ("p9198..."),
 * "Tasker 0077" (old phone sign-ups), an email, or "New user". Forms never offer these as the person's name.
 */
export function isPlaceholderName(name: string | null | undefined): boolean {
  const n = (name ?? '').trim();
  if (!n) return true;
  return /^p\d{10}$/.test(n) || /^tasker \d{4}$/i.test(n) || n.includes('@') || n === 'New user';
}
