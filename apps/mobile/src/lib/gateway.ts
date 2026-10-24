import { FUNCTIONS_REGION, supabase } from './supabase';
import { ApiError, apiError } from './errors';
import { clientHeaders } from './appInfo';
import { appCheckHeaders } from './appCheck';
import { refreshAppConfig } from './appConfig';
import { log } from './monitoring';
import { Batcher, type Reply as BatchReply } from './batcher';

type Reply<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; code?: string | null; details?: string | null } };

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
  const { data, error } = await supabase.functions.invoke('api', {
    body: { op, args },
    region: FUNCTIONS_REGION,
    headers: { ...clientHeaders(), ...(await appCheckHeaders()) },
  });

  if (error) {
    const context = (error as { context?: unknown }).context;
    const status = context instanceof Response ? context.status : undefined;
    // A refusal from our server (too many requests, session expired) carries
    // its own plain-words message in the body; use it rather than a guess.
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as Reply<T>;
        if (body && body.ok === false && body.error?.message) {
          throw refused(body.error, op);
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        /* not our JSON — fall through */
      }
    }
    // Only the op name and status are logged, never the arguments.
    log.warn('request did not reach the server', { op, status: status ?? null });
    throw apiError({ message: error.message, status });
  }

  const reply = data as Reply<T> | null;
  if (!reply || typeof reply !== 'object' || !('ok' in reply)) {
    log.error('unreadable reply from the server', { op });
    throw apiError({ message: 'unreadable reply' });
  }
  if (!reply.ok) {
    const { message, code, details } = reply.error;
    throw refused({ message, code, details }, op);
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
const NOTABLE_REFUSALS = new Set(['INTERNAL', 'RATE_LIMITED', 'MAINTENANCE', 'UPDATE_REQUIRED', 'FEATURE_OFF', 'UNAUTHENTICATED']);

/** A refusal by the server, as an error. One caused by an admin switch also refreshes what the app shows. */
function refused(e: { message: string; code?: string | null; details?: string | null }, op: string): ApiError {
  if (e.code && NOTABLE_REFUSALS.has(e.code)) log[e.code === 'INTERNAL' ? 'error' : 'warn']('server refused a request', { op, code: e.code });
  if (e.code === 'MAINTENANCE' || e.code === 'UPDATE_REQUIRED' || e.code === 'FEATURE_OFF') void refreshAppConfig(true);
  return new ApiError(e.message, e.code ?? null, e.message, e.details ?? null);
}
