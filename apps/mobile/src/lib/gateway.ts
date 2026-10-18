import { FUNCTIONS_REGION, supabase } from './supabase';
import { ApiError, apiError } from './errors';
import { clientHeaders } from './appInfo';
import { refreshAppConfig } from './appConfig';

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
 */
export async function callApi<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  // The platform and app version let the server apply the admin panel's
  // per-platform switches (maintenance, minimum version, features off).
  const { data, error } = await supabase.functions.invoke('api', {
    body: { op, args },
    region: FUNCTIONS_REGION,
    headers: clientHeaders(),
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
          throw refused(body.error);
        }
      } catch (e) {
        if (e instanceof ApiError) throw e;
        /* not our JSON — fall through */
      }
    }
    throw apiError({ message: error.message, status });
  }

  const reply = data as Reply<T> | null;
  if (!reply || typeof reply !== 'object' || !('ok' in reply)) throw apiError({ message: 'unreadable reply' });
  if (!reply.ok) {
    const { message, code, details } = reply.error;
    throw refused({ message, code, details });
  }
  return reply.data;
}

/** A refusal by the server, as an error. One caused by an admin switch also refreshes what the app shows. */
function refused(e: { message: string; code?: string | null; details?: string | null }): ApiError {
  if (e.code === 'MAINTENANCE' || e.code === 'UPDATE_REQUIRED' || e.code === 'FEATURE_OFF') void refreshAppConfig(true);
  return new ApiError(e.message, e.code ?? null, e.message, e.details ?? null);
}
