import { FUNCTIONS_REGION, supabase } from './supabase';
import { ApiError, apiError } from './errors';
import { clientHeaders, randomId } from './appInfo';
import { appCheckHeaders } from './appCheck';
import { refreshAppConfig } from './appConfig';
import { log } from './monitoring';
import { BATCHABLE_OPS, Batcher, type Reply as BatchReply } from './batcher';
import { READ_TIMEOUT_MS, RETRY_DELAYS_MS, WRITE_RETRY_DELAYS_MS, isTransient, retryWhile, type Failure } from './retry';
import { IN_PROGRESS_STATUS, RepeatKeys, outcomeUnknown } from './repeatKeys';
import { noteChange, setPerson } from './freshness';

/**
 * Whose answers the app may remember (lib/freshness.ts, plan 3.5b layer A, H69). Every call here travels
 * with the session supabase-js holds, so every change of that session reaches this listener: the first
 * session on start-up, a sign-in, a sign-out (an account deletion signs out too), a token renewal and a
 * switch to another account. A different person, or none, empties every memory at once. Registered here
 * because every read goes through this file, so it is in place before the first one.
 */
supabase.auth.onAuthStateChange((_event, session) => {
  setPerson(session?.user.id ?? null);
});

/**
 * Writes that change nothing this person's screens show (their own presence, device and push
 * records, ad counters). Every other write tells lib/freshness.ts that what was read may be out of date.
 * settleClearedEarnings is told by its caller, and only when it actually moved money.
 */
const BOOKKEEPING = new Set(['touchPresence', 'recordDevice', 'registerPushToken', 'forgetPushToken', 'recordAdImpression', 'recordAdClick', 'settleClearedEarnings']);

/** Which repeat key each write carries (./repeatKeys.ts). */
const repeatKeys = new RepeatKeys(randomId);

type Reply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code?: string | null; details?: string | null } };

/** What a failed call looked like from outside: the status, whether it was our own `{ ok: false }` reply, or no answer at all. */
async function describeFailure(error: unknown): Promise<Failure> {
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return { network: true };
  let ours = false;
  try {
    const body = (await context.clone().json()) as Reply<unknown>;
    ours = !!body && body.ok === false && !!body.error?.message;
  } catch {
    /* not our JSON: a gateway page or an empty body */
  }
  return { status: context.status, ours };
}

/**
 * Ask the server to do something, by name.
 *
 * The app says *what* it wants (`placeBid`, `lockBid`, ...) and the server
 * decides how: which tables, which columns, which checks. None of that is in
 * the bundle a customer downloads. See supabase/functions/api.
 *
 * A refusal from the server arrives with its message already in plain words,
 * so it is used as-is. A transport failure (offline, expired session) goes
 * through the same wording the rest of the app uses.
 *
 * Reads asked for at the same moment travel together as one request (see
 * ./batcher.ts); everything else goes out alone, exactly as before.
 */
async function callApiDirect<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  // The platform and app version let the server apply the admin panel's
  // per-platform switches (maintenance, minimum version, features off).
  // A read that hits a blip (a deploy, a dropped connection, no answer within READ_TIMEOUT_MS) is asked
  // again, twice, before it counts as a failure. A write is never timed out (giving up half way would leave
  // its outcome unknown). It carries a repeat key, so the server does it once however often it arrives,
  // and a blip is asked again with the same key, the way a read is.
  const isRead = op === 'batch' || BATCHABLE_OPS.has(op);
  const changes = !isRead && !BOOKKEEPING.has(op);
  const repeatKey = changes ? repeatKeys.take(op, args) : null;
  // One id per call, kept across its retries: the server logs it beside every line about the call,
  // so a failure someone reports can be found (supabase/functions/api/http.ts).
  const requestId = randomId();
  const invokeOnce = async () =>
    supabase.functions.invoke('api', {
      body: { op, args },
      region: FUNCTIONS_REGION,
      headers: {
        ...clientHeaders(),
        ...(await appCheckHeaders()),
        'x-request-id': requestId,
        ...(repeatKey ? { 'Idempotency-Key': repeatKey } : {}),
      },
      ...(isRead ? { timeout: READ_TIMEOUT_MS } : {}),
    });

  // Marked on the way out and on the way back: a screen shown in between asks the server again either way.
  if (changes) noteChange();
  let unknown = true;
  const { data, error } = await (async () => {
    try {
      const result = await retryWhile(
        invokeOnce,
        async (r) => {
          if (!r.error) return false;
          const f = await describeFailure(r.error);
          // "Still going through" (the same write is running): wait, then ask for its answer with the same key.
          return isTransient(f) || (repeatKey !== null && f.ours === true && f.status === IN_PROGRESS_STATUS);
        },
        isRead ? RETRY_DELAYS_MS : repeatKey ? WRITE_RETRY_DELAYS_MS : [],
      );
      unknown = outcomeUnknown(result.error ? await describeFailure(result.error) : null);
      return result;
    } finally {
      if (repeatKey) repeatKeys.settle(op, args, repeatKey, unknown);
      if (changes) noteChange();
    }
  })();

  if (error) {
    const context = (error as { context?: unknown }).context;
    const status = context instanceof Response ? context.status : undefined;
    // A refusal from our server (too many requests, session expired) carries
    // its own plain-words message in the body; use it rather than a guess.
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as Reply<T>;
        if (body && body.ok === false && body.error?.message) {
          throw refused(body.error, op, requestId);
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        /* not our JSON — fall through */
      }
    }
    // Only the op name and status are logged, never the arguments.
    log.warn('request did not reach the server', { op, status: status ?? null, request_id: requestId });
    throw apiError({ message: error.message, status });
  }

  const reply = data as Reply<T> | null;
  if (!reply || typeof reply !== 'object' || !('ok' in reply)) {
    log.error('unreadable reply from the server', { op, request_id: requestId });
    throw apiError({ message: 'unreadable reply' });
  }
  if (!reply.ok) {
    const { message, code, details } = reply.error;
    throw refused({ message, code, details }, op, requestId);
  }
  return reply.data;
}

const batcher = new Batcher({
  send: (calls) => callApiDirect<BatchReply[]>('batch', { calls }),
  single: callApiDirect,
  refuse: (error, op) => refused(error, op),
});

export const callApi = <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => batcher.call<T>(op, args);

/** Refusals worth a log line: the server broke, or the person is being held back. Ordinary rule refusals (not enough money, quote taken) are not. */
const NOTABLE_REFUSALS = new Set([
  'INTERNAL', 'RATE_LIMITED', 'TOO_LARGE', 'MAINTENANCE', 'UPDATE_REQUIRED', 'FEATURE_OFF', 'UNAUTHENTICATED', 'IN_PROGRESS', 'OUTCOME_UNKNOWN', 'KEY_REUSED',
]);

/** A refusal by the server, as an error. One caused by an admin switch also refreshes what the app shows. */
function refused(e: { message: string; code?: string | null; details?: string | null }, op: string, requestId?: string): ApiError {
  if (e.code && NOTABLE_REFUSALS.has(e.code)) log[e.code === 'INTERNAL' ? 'error' : 'warn']('server refused a request', { op, code: e.code, request_id: requestId ?? null });
  if (e.code === 'MAINTENANCE' || e.code === 'UPDATE_REQUIRED' || e.code === 'FEATURE_OFF') void refreshAppConfig(true);
  return new ApiError(e.message, e.code ?? null, e.message, e.details ?? null);
}
