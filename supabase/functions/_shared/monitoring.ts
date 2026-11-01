import { secret } from "./secrets.ts";
import { parseStack } from "./stack.ts";
import { scrubText } from "./scrub.ts";
import { withCors } from "./cors.ts";

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
 * attribute. Ids (task, payment, payout) and codes are fine. As a last net, everything sent passes
 * through scrub.ts, which hides keys, phone numbers and emails it finds.
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
      tags: Object.fromEntries(Object.entries(context).map(([k, v]) => [k, scrubText(String(v))])),
      exception: { values: [{ type: e.name, value: scrubText(e.message), ...(frames.length ? { stacktrace: { frames } } : {}) }] },
    };
    await send(d, [[{ type: "event" }, event]], id);
  } catch {
    // Monitoring is best-effort; it must never become the error.
  }
}

/**
 * Things an attacker causes, counted so a spike can email the owner (plan task 2.10). Each kind is one Sentry issue
 * ("security: <kind>") tagged `security_event`, so one alert rule per kind ("seen more than N times in an hour") is enough.
 *
 *   refused_login      a wrong sign-in code, a wrong password, a request with a bad or missing login
 *   app_check_failed   a request whose App Check token is not from the real app
 *   bad_signature      a payment or payout message whose signature is wrong (a forged webhook)
 *   sms_code_sent      a real sign-in SMS went out (a sudden rise is SMS pumping)
 *   sms_budget_hit     the per-address or daily limit on sign-in codes stopped a request
 *
 * One event per kind per instance per hour is plenty to make the issue count rise; at most 20 per kind per instance per hour
 * are sent, so an attack cannot use up the Sentry quota. No phone number, name, address or token is ever included: counts only.
 */
export type SecurityKind = "refused_login" | "app_check_failed" | "bad_signature" | "sms_code_sent" | "sms_budget_hit";
const securitySeen = new Map<string, { windowStart: number; sent: number }>();
const SECURITY_PER_HOUR = 20;

export async function captureSecurityEvent(kind: SecurityKind, fn: string): Promise<void> {
  try {
    const now = Date.now();
    const seen = securitySeen.get(kind);
    if (!seen || now - seen.windowStart > 3_600_000) securitySeen.set(kind, { windowStart: now, sent: 1 });
    else if (seen.sent >= SECURITY_PER_HOUR) return;
    else seen.sent++;

    const d = await dsn();
    if (!d) return;
    const id = crypto.randomUUID().replace(/-/g, "");
    const event = {
      event_id: id,
      timestamp: now / 1000,
      platform: "javascript",
      level: "warning",
      server_name: "edge-function",
      environment: environment(),
      message: `security: ${kind}`,
      fingerprint: ["security", kind],
      tags: { security_event: kind, fn },
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
    for (const [k, v] of Object.entries(attributes)) if (v !== null && v !== undefined) attrs[k] = attr(typeof v === "string" ? scrubText(v) : v);
    const item = {
      timestamp: Date.now() / 1000,
      trace_id: crypto.randomUUID().replace(/-/g, ""),
      level,
      body: scrubText(message),
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
 * Also decides the CORS answer from who is asking (_shared/cors.ts), whatever the handler wrote.
 *
 * Wrap a function's request handler so anything it throws and does not catch
 * is reported (with a readable stack) and answered with a plain 500, instead of
 * vanishing into the function logs. Expected refusals are not exceptions and
 * never reach this.
 */
export function guarded(fn: string, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return withCors(async (req) => {
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
  });
}

/** Let a send finish after the response has gone out, so it never slows a request down. */
export function background(work: Promise<unknown>): void {
  (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(work);
}
