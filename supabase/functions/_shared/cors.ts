/**
 * Which websites may call the Edge Functions from a browser (task 2.6, hole H8).
 *
 * Before: every function answered `Access-Control-Allow-Origin: *`, so any website a signed-in person
 * visited could have called them with that person's token. Now the answer names the caller's own
 * origin only when it is on the list, and says nothing otherwise, so the browser refuses the call.
 *
 * The Android app and every server (Razorpay's webhooks, the admin panel's server actions) send no
 * `Origin` header and are not subject to CORS, so they are not affected.
 *
 * The list is the `ALLOWED_ORIGINS` secret (comma-separated, exact origins). When it is not set, the
 * default is the STAGING list below. Production sets it in Step 5 (5.9, 5.10) to its own web addresses
 * only (the addresses Vercel makes for the production projects), with no taskdrop.in, no localhost and
 * no staging address. taskdrop.in is staging's since 5 Nov 2026 (plan decision 1).
 */

/** Staging: the website's own addresses, the two addresses Vercel makes, and a dev server on this computer. */
export const STAGING_ORIGINS = [
  "https://taskdrop.in", // staging's own name (plan 5.0b); production uses Vercel's addresses (5.10)
  "https://www.taskdrop.in",
  "https://taskdrop-five.vercel.app",
  "https://taskdrop-git-redesigned-20-hitenduteam.vercel.app",
];

/** `http://localhost:8081`, `http://127.0.0.1:8099`: any port, staging only. */
const LOCAL_DEV = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;

export function parseOrigins(raw: string | undefined | null): string[] | null {
  const list = (raw ?? "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
  return list.length ? list : null;
}

/** Whether a browser page at `origin` may call the functions. A missing Origin (an app or a server) is not a browser. */
export function originAllowed(origin: string | null, raw: string | undefined | null): boolean {
  if (!origin) return false;
  const configured = parseOrigins(raw);
  if (configured) return configured.includes(origin);
  return STAGING_ORIGINS.includes(origin) || LOCAL_DEV.test(origin);
}

/** The same response, with the CORS answer decided by who is asking. */
export function applyCors(req: Request, res: Response, raw: string | undefined | null): Response {
  const headers = new Headers(res.headers);
  headers.delete("Access-Control-Allow-Origin");
  const origin = req.headers.get("Origin");
  if (originAllowed(origin, raw)) headers.set("Access-Control-Allow-Origin", origin as string);
  // The answer depends on the Origin, so a shared cache must not reuse it for another site.
  headers.append("Vary", "Origin");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export function withCors(handler: (req: Request) => Promise<Response> | Response): (req: Request) => Promise<Response> {
  return async (req) => applyCors(req, await handler(req), Deno.env.get("ALLOWED_ORIGINS"));
}
