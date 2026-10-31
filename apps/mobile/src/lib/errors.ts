/**
 * One place that decides what a failure looks like to the person using the app.
 *
 * A database or API error carries wording written for developers: table and
 * column names, policy names, constraint names. That is internal detail a
 * customer should never see (and it hands anyone poking at the app a map of the
 * schema), so errors are turned into plain sentences here, once, at the point
 * they are raised. Every `catch` that shows `e.message` then shows safe text.
 *
 * The one exception is a message a SQL function raised on purpose
 * (`raise exception 'Quote not found'`). Those carry SQLSTATE P0001 and are
 * written for the user, so they pass through unchanged.
 */

/** The shape every supabase-js error shares, whatever produced it. */
export type RawError = {
  message: string;
  code?: string | null;
  status?: number | null;
  details?: string | null;
};

const GENERIC = 'Something went wrong. Please try again.';
const OFFLINE = 'Could not reach TaskDrop. Check your connection and try again.';
const SIGNED_OUT = 'Your session has expired. Please sign in again.';
const DENIED = 'You do not have permission to do that.';
const DUPLICATE = 'That already exists.';
const GONE = 'That is no longer available.';
const INVALID = 'Please check what you entered and try again.';
/** What a sign-in says when Supabase refuses a closed (deleted or suspended) account as "User is banned". */
export const ACCOUNT_CLOSED = 'This account is closed. Contact support.';

/** An error whose `message` is safe to show. The original stays on `raw`, never displayed. */
export class ApiError extends Error {
  readonly code: string | null;
  readonly raw: string;
  /** A detail a SQL function wrote on purpose (the wallet shortfall); null otherwise. */
  readonly details: string | null;

  constructor(message: string, code: string | null, raw: string, details: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.raw = raw;
    this.details = details;
  }
}

/** The text to show for a raw error. */
export function friendlyMessage(err: RawError, fallback = GENERIC): string {
  const code = err.code ?? '';
  const raw = err.message ?? '';

  // Written on purpose for the user by a SQL function.
  if (code === 'P0001') return raw;

  // Before the 401/403 wording below: a closed account is refused with a 403.
  if (code === 'user_banned' || /user is banned|account is banned/i.test(raw)) return ACCOUNT_CLOSED;

  if (/network request failed|failed to fetch|failed to send a request|fetch failed|load failed|networkerror|timed? ?out|econn|enotfound/i.test(raw)) {
    return OFFLINE;
  }
  if (err.status === 401 || /^PGRST30[123]$/.test(code) || /jwt|not authenticated|invalid refresh token/i.test(raw)) {
    return SIGNED_OUT;
  }
  if (err.status === 403 || code === '42501' || /row-level security|permission denied|violates.*policy/i.test(raw)) {
    return DENIED;
  }
  if (code === '23505' || /duplicate key|already exists/i.test(raw)) return DUPLICATE;
  if (code === '23503') return GONE;
  if (code === '23502' || code === '23514' || code === '22P02' || code === '22001') return INVALID;
  return fallback;
}

/**
 * Where raw failures go. Dev builds print them so they can be fixed; release
 * builds stay quiet on the device. `installMonitoring` (lib/monitoring.ts)
 * points `setErrorReporter` at Sentry; every failure the app wants seen goes
 * through `reportError`, nowhere else.
 */
type Reporter = (err: unknown, context?: string) => void;

let reporter: Reporter = (err, context) => {
  if (__DEV__) console.warn(`[error${context ? `:${context}` : ''}]`, err);
};

export function setErrorReporter(fn: Reporter): void {
  reporter = fn;
}

/** Report a failure without ever letting the reporter itself throw. */
export function reportError(err: unknown, context?: string): void {
  try {
    reporter(err, context);
  } catch {
    // Reporting is best-effort; a broken reporter must not become a second crash.
  }
}

/**
 * What kind of failed call this was, so monitoring can tell noise from a bug.
 *   offline     the phone could not reach the server
 *   signed_out  the session ended; the person just signs in again
 *   refused     the server said no on purpose (not enough money, a duplicate,
 *               not allowed): expected, and shown to the person as written
 *   unexpected  anything else (a 5xx, a broken query): worth a look
 */
export type ApiFailureKind = 'offline' | 'signed_out' | 'refused' | 'unexpected';

export function apiFailureKind(err: RawError): ApiFailureKind {
  // friendlyMessage answers '' only for a failure it has no wording for.
  const message = friendlyMessage(err, '');
  if (message === OFFLINE) return 'offline';
  if (message === SIGNED_OUT) return 'signed_out';
  return message === '' ? 'unexpected' : 'refused';
}

/** Build the error to throw for a failed database or API call. */
export function apiError(err: RawError): ApiError {
  const code = err.code ?? null;
  const e = new ApiError(friendlyMessage(err), code, err.message ?? '', code === 'P0001' ? (err.details ?? null) : null);
  reportError(err, 'api');
  return e;
}

/** Text for any caught value: an `ApiError`/`Error` shows its message, anything else a safe default. */
export function messageOf(e: unknown, fallback = GENERIC): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
