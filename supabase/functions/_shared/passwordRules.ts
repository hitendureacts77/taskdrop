/**
 * Password rules (hole H30, OWASP ASVS 2.1.1, 2.1.6, 2.1.8, 2.2.3).
 *
 * The server's copy. `apps/mobile/src/lib/passwordRules.ts` is the app's copy, so the
 * form can say what is wrong before anything is sent; `passwordRules.test.ts` checks that
 * both give the same answer. Pure TypeScript, no Deno or React Native APIs.
 */

/** ASVS 2.1.1: at least 12 characters. */
export const PASSWORD_MIN = 12;
/** Supabase stores passwords with bcrypt, which reads only the first 72 bytes. */
export const PASSWORD_MAX_BYTES = 72;
/** How long a sign-in by text code or Google counts as "just proved who you are" (the forgotten-password path). */
export const FRESH_SIGN_IN_SECONDS = 15 * 60;

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
  // "Password12345!" or "qwerty123456" are a common word with padding: refuse them.
  const letters = lower.replace(/[^a-z]/g, '');
  if (letters.length > 0 && COMMON.includes(letters)) return 'Too easy to guess';
  return null;
}

/** ASVS 2.1.8: a strength hint for the form. 0 = too short or refused, 1 fair, 2 good, 3 strong. */
export function passwordStrength(password: string, username?: string | null): { score: 0 | 1 | 2 | 3; label: string } {
  if (passwordProblem(password, username)) return { score: 0, label: password ? 'Too weak' : '' };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  let score = 1;
  if (password.length >= 16) score++;
  if (kinds >= 3) score++;
  const s = Math.min(score, 3) as 1 | 2 | 3;
  return { score: s, label: s === 3 ? 'Strong' : s === 2 ? 'Good' : 'Fair' };
}

type AmrEntry = { method?: unknown; timestamp?: unknown };

/** The `amr` list inside a Supabase access token, without checking the signature (the caller already has). */
export function tokenAmr(jwt: string): AmrEntry[] {
  try {
    const part = jwt.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload = JSON.parse(atob(b64)) as { amr?: unknown };
    return Array.isArray(payload.amr) ? (payload.amr as AmrEntry[]) : [];
  } catch {
    return [];
  }
}

/**
 * True when the session's latest sign-in was NOT a password (a text code or Google) and happened in the
 * last 15 minutes. That is a fresh proof of who the person is, so a forgotten password can be replaced
 * without typing the old one: sign in with the phone number, then set a new password straight away.
 */
export function freshNonPasswordSignIn(amr: AmrEntry[], nowSeconds: number): boolean {
  const entries = amr
    .filter((e) => typeof e.method === 'string' && typeof e.timestamp === 'number')
    .sort((a, b) => (b.timestamp as number) - (a.timestamp as number));
  const latest = entries[0];
  if (!latest || latest.method === 'password') return false;
  const age = nowSeconds - (latest.timestamp as number);
  return age >= -60 && age <= FRESH_SIGN_IN_SECONDS;
}
