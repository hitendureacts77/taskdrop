/** How long the browser is asked to wait for the SMS before giving up (one-tap login plan 1.2). */
export const WEB_OTP_WAIT_MS = 5 * 60 * 1000;

/** The six-digit code out of what the browser hands back, or null. */
export function sixDigits(v: unknown): string | null {
  const m = typeof v === 'string' ? /^\d{6}$/.exec(v.trim()) : null;
  return m ? m[0] : null;
}

type OtpGet = (options: { otp: { transport: string[] }; signal: AbortSignal }) => Promise<{ code?: unknown } | null>;

/**
 * WebOTP: while the code step is open, Chrome on Android offers the code from the SMS with one "Allow" tap,
 * and the code boxes fill (then the screen's own auto-verify runs). It only works once real SMS ends with the
 * line `@taskdrop.in #123456` (owner step O7); until then the browser simply never answers. Returns a stop
 * function: call it when the step closes. The SMS text is never read or logged here, only the code.
 */
export function listenForSmsCode(onCode: (code: string) => void): () => void {
  if (typeof window === 'undefined' || !('OTPCredential' in window)) return () => {};
  const credentials = (navigator as Navigator & { credentials?: { get?: OtpGet } }).credentials;
  if (!credentials?.get) return () => {};
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), WEB_OTP_WAIT_MS);
  credentials
    .get({ otp: { transport: ['sms'] }, signal: ctrl.signal })
    .then((got) => {
      const code = sixDigits(got?.code);
      if (code && !ctrl.signal.aborted) onCode(code);
    })
    // Aborted, dismissed or unsupported: typing the code still works.
    .catch(() => {})
    .finally(() => clearTimeout(timer));
  return () => {
    clearTimeout(timer);
    ctrl.abort();
  };
}
