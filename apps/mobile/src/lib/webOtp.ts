/**
 * WebOTP (one-tap login plan 1.2) is a website feature: Chrome on Android offers the code from the SMS.
 * The apps read the code their own way (autoComplete="sms-otp"), so here it does nothing.
 */
export function listenForSmsCode(_onCode: (code: string) => void): () => void {
  return () => {};
}
