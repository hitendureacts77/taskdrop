/**
 * Password rules for the form (hole H30). The server's copy is
 * `supabase/functions/_shared/passwordRules.ts`, and the server is the one that decides;
 * `passwordRules.test.ts` checks both copies agree.
 */

export const PASSWORD_MIN = 12;
const PASSWORD_MAX_BYTES = 72;

const COMMON = [
  'password', 'passw0rd', 'qwerty', 'qwertyuiop', 'asdfghjkl', 'letmein', 'welcome', 'iloveyou',
  'admin', 'abc123', 'monkey', 'dragon', 'football', 'cricket', 'india', 'taskdrop', 'sunshine', 'princess',
];

const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;

/** What is wrong with a new password, in one short sentence, or null when it is fine. */
export function passwordProblem(password: string, username?: string | null): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (utf8Bytes(password) > PASSWORD_MAX_BYTES) return 'Use at most 72 characters';
  if (/^(.)\1+$/.test(password)) return 'Do not repeat one character';
  const lower = password.toLowerCase();
  const name = (username ?? '').trim().replace(/^@/, '').toLowerCase();
  if (name.length >= 3 && lower.includes(name)) return 'Do not use your username in the password';
  if (/^\d+$/.test(password) && ('01234567890123456789'.includes(password) || '98765432109876543210'.includes(password))) {
    return 'Too easy to guess';
  }
  const letters = lower.replace(/[^a-z]/g, '');
  if (letters.length > 0 && COMMON.includes(letters)) return 'Too easy to guess';
  return null;
}

/** A strength hint: 0 = too short or refused, 1 fair, 2 good, 3 strong. */
export function passwordStrength(password: string, username?: string | null): { score: 0 | 1 | 2 | 3; label: string } {
  if (passwordProblem(password, username)) return { score: 0, label: password ? 'Too weak' : '' };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let score = 1;
  if (password.length >= 16) score++;
  if (kinds >= 3) score++;
  const s = Math.min(score, 3) as 1 | 2 | 3;
  return { score: s, label: s === 3 ? 'Strong' : s === 2 ? 'Good' : 'Fair' };
}
