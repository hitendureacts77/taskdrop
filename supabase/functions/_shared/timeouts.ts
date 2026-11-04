/**
 * How long a person may be kept waiting for an outside service (task 2.13 part J, design rule 10).
 *
 * A call to SMS, Google, Razorpay or the auth service that never answers would otherwise hold the person's request
 * open until the platform's own limit (minutes). Every such call that a person waits for carries this signal, so a
 * slow provider ends in a plain failure message after a few seconds instead of a spinner.
 * Calls that move money are left alone on purpose: a refund that times out may still have happened, and the claim /
 * release steps around it are what keep that safe.
 */
export const OUTSIDE_CALL_MS = 8_000;

/** A fresh abort signal for one outside call. */
export const outsideCall = (ms: number = OUTSIDE_CALL_MS): AbortSignal => AbortSignal.timeout(ms);
