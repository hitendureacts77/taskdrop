import { secret } from "./secrets.ts";
import { parseStack } from "./stack.ts";

/**
 * Sentry for the Edge Functions, if SENTRY_DSN is configured (as an Edge
 * Function secret or in Vault). Without it, errors still go to the function
 * logs and nothing else happens.
 *
 * Speaks Sentry's envelope format directly rather than pulling in an SDK: one
 * POST per error or log line, nothing kept between requests. Never throws.
 *
 *   captureServerError  an unexpected failure, shown under Issues.
 *   logServer           a line for Explore > Logs: what happened, in order,
 *                       around an issue. Use it for the moments that matter in
 *                       production (a payment settled, a payout refused, a
 *                       webhook with a bad signature), not for every request.
 *
 * Never put a phone number, email, name, address or token in a message or
 * attribute. Ids (task, payment, payout) and codes are fine.
 */

type Dsn = { key: string; host: string; project: string };

async function dsn(): Promise<Dsn | null> {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec((await secret("SENTRY_DSN")) ?? "");
  return m ? { key: m[1], host: m[2], project: m[3] } : null;
}

const environment = () => Deno.env.get("SENTRY_ENVIRONMENT") ?? "production";

async function send(d: Dsn, items: [Record<string, unknown>, Record<string, unknown>][], eventId: string): Promise<void> {
  const body = [
    JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }),
    ...items.flatMap(([header, payload]) => [JSON.stringify(header), JSON.stringify(payload)]),
  ].join("\n");
  await fetch(`https://${d.host}/api/${d.project}/envelope/?sentry_key=${d.key}&sentry_version=7`, {
    method: "POST",
    headers: { "Content-Type": "application/x-sentry-envelope" },
    body,
  });
}

/**
 * Send an unexpected server error to Sentry. Use `fatal` for the failures that
 * mean money moved and the books do not know (a payout or refund made but not
 * recorded): the alert rules page on that level.
 */
export async function captureServerError(
  err: unknown,
  context: Record<string, string> = {},
  level: "error" | "fatal" = "error",
): Promise<void> {
  try {
    const d = await dsn();
    if (!d) return;
    const id = crypto.randomUUID().replace(/-/g, "");
    const e = err instanceof Error ? err : new Error(typeof err === "object" && err !== null && "message" in err ? String((err as { message: unknown }).message) : String(err));
    const frames = parseStack(e.stack);
    const event = {
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      level,
      server_name: "edge-function",
      environment: environment(),
      tags: context,
      exception: { values: [{ type: e.name, value: e.message, ...(frames.length ? { stacktrace: { frames } } : {}) }] },
    };
    await send(d, [[{ type: "event" }, event]], id);
  } catch {
    // Monitoring is best-effort; it must never become the error.
  }
}

export type LogLevel = "info" | "warn" | "error";
export type LogAttributes = Record<string, string | number | boolean | null | undefined>;

const attr = (v: string | number | boolean) =>
  typeof v === "number"
    ? { value: v, type: Number.isInteger(v) ? "integer" : "double" }
    : { value: v, type: typeof v === "boolean" ? "boolean" : "string" };

/**
 * Write one log line to Sentry. `fn` names the Edge Function it came from, so
 * the logs can be filtered by it. Also printed to the function logs.
 *
 * Returns a promise so a caller can hand it to `waitUntil` (see `background`);
 * awaiting it is fine too.
 */
export async function logServer(level: LogLevel, fn: string, message: string, attributes: LogAttributes = {}): Promise<void> {
  console[level === "info" ? "log" : level](`${fn}: ${message}`, attributes);
  try {
    const d = await dsn();
    if (!d) return;
    const attrs: Record<string, { value: string | number | boolean; type: string }> = {
      fn: attr(fn),
      "sentry.environment": attr(environment()),
    };
    for (const [k, v] of Object.entries(attributes)) if (v !== null && v !== undefined) attrs[k] = attr(v);
    const item = {
      timestamp: Date.now() / 1000,
      trace_id: crypto.randomUUID().replace(/-/g, ""),
      level,
      body: message,
      attributes: attrs,
    };
    await send(
      d,
      [[{ type: "log", item_count: 1, content_type: "application/vnd.sentry.items.log+json" }, { items: [item] }]],
      crypto.randomUUID().replace(/-/g, ""),
    );
  } catch {
    // Monitoring is best-effort; it must never become the error.
  }
}

/**
 * Wrap a function's request handler so anything it throws and does not catch
 * is reported (with a readable stack) and answered with a plain 500, instead of
 * vanishing into the function logs. Expected refusals are not exceptions and
 * never reach this.
 */
export function guarded(fn: string, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      return await handler(req);
    } catch (e) {
      console.error(`${fn}: unhandled`, e);
      await Promise.all([
        logServer("error", fn, "unhandled error", { error: e instanceof Error ? e.message : String(e) }),
        captureServerError(e, { fn, step: "unhandled" }),
      ]);
      return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
        status: 500,
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
  };
}

/** Let a send finish after the response has gone out, so it never slows a request down. */
export function background(work: Promise<unknown>): void {
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(work);
}
