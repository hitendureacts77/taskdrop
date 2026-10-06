import { FUNCTIONS_REGION, supabase } from './supabase';
import { ApiError, apiError } from './errors';

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
  const { data, error } = await supabase.functions.invoke('api', { body: { op, args }, region: FUNCTIONS_REGION });

  if (error) {
    const context = (error as { context?: unknown }).context;
    const status = context instanceof Response ? context.status : undefined;
    // A refusal from our server (too many requests, session expired) carries
    // its own plain-words message in the body; use it rather than a guess.
    if (context instanceof Response) {
      try {
        const body = (await context.clone().json()) as Reply<T>;
        if (body && body.ok === false && body.error?.message) {
          throw new ApiError(body.error.message, body.error.code ?? null, body.error.message, null);
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
    throw new ApiError(message, code ?? null, message, details ?? null);
  }
  return reply.data;
}
