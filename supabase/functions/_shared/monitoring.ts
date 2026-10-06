import { secret } from "./secrets.ts";

/**
 * Send an unexpected server error to Sentry, if SENTRY_DSN is configured (as
 * an Edge Function secret or in Vault). Without it, errors still go to the
 * function logs and nothing else happens.
 *
 * Speaks Sentry's envelope format directly rather than pulling in an SDK: one
 * POST per error, nothing kept between requests. Never throws.
 */
export async function captureServerError(err: unknown, context: Record<string, string> = {}): Promise<void> {
  try {
    const dsn = await secret("SENTRY_DSN");
    const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn ?? "");
    if (!m) return;
    const [, key, host, project] = m;
    const id = crypto.randomUUID().replace(/-/g, "");
    const e = err instanceof Error ? err : new Error(String(err));
    const event = {
      event_id: id,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      level: "error",
      server_name: "edge-function",
      environment: Deno.env.get("SENTRY_ENVIRONMENT") ?? "production",
      tags: context,
      exception: { values: [{ type: e.name, value: e.message }] },
      extra: { stack: e.stack ?? null },
    };
    const body = [
      JSON.stringify({ event_id: id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: "event" }),
      JSON.stringify(event),
    ].join("\n");
    await fetch(`https://${host}/api/${project}/envelope/?sentry_key=${key}&sentry_version=7`, {
      method: "POST",
      headers: { "Content-Type": "application/x-sentry-envelope" },
      body,
    });
  } catch {
    // Monitoring is best-effort; it must never become the error.
  }
}
