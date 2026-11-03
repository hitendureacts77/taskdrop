/**
 * The "Report a security problem" part of the Support page (task 2.13 part D, docs/ULTIMATE_PLAN.md).
 *
 * The promise not to take legal action is a legal text, so these words go to the lawyer with the Terms
 * (plan task S.3) before launch. Until then they are the draft the owner approved on 3 Nov 2026.
 * The same address and link are in /.well-known/security.txt (apps/mobile/scripts/web-env-guard.mjs).
 */

export const SECURITY_REPORT_TITLE = 'Report a security problem';

export const SECURITY_REPORT_INTRO =
  'If you find a way to reach someone else\'s data, to move money you should not, or to break into TaskDrop, tell us. We would rather hear it from you first.';

/** What a good-faith report may and may not do. */
export const SECURITY_REPORT_RULES: string[] = [
  'Test only with accounts you made yourself, and with fake or test money.',
  'Never open, change or keep another person\'s data. If you reach it by accident, stop and tell us.',
  'No floods of requests, no sending text messages in bulk, and no tricking our staff or users.',
  'No attacks on the companies we use, such as Razorpay, MSG91 or Google.',
  'Give us time to fix the problem before you tell anyone else.',
];

/** What TaskDrop promises back. */
export const SECURITY_REPORT_PROMISES: string[] = [
  'We reply within 3 working days.',
  'We will not take legal action against a report made in good faith that follows these rules.',
  'If you like, your name goes on our thank-you list once the problem is fixed. We do not pay cash rewards at this stage.',
];

/** How to say "send the report" in words: the address when there is one, otherwise the in-app route. */
export function securityReportContact(email: string | null): string {
  return email
    ? `Email ${email} with what you found, the steps to repeat it, and the account you used.`
    : 'Write to us through Help & support in the app with what you found, the steps to repeat it, and the account you used.';
}
