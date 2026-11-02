/**
 * The gateway's own front-door rules, checked before any operation runs: how big
 * a request may be, which id it is traced under, and the headers every answer
 * carries.
 *
 * No Deno imports on purpose, so the tests run from Node.
 */

/**
 * The largest request body the gateway reads. The biggest real call (a new task
 * with a long description, or a batch of 20 reads) is a few kilobytes; pictures
 * and files never pass through here (they go straight to ImageKit or Storage
 * with a signed upload). Anything bigger is refused with 413 before it is parsed.
 */
export const MAX_BODY_BYTES = 256 * 1024;

/** Sent by the app with every call and returned on every answer, so one failing call can be found in the logs. */
export const REQUEST_ID_HEADER = "x-request-id";

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** The app's id for this call when it sent a usable one, otherwise a new one. Never trusted for anything but logs. */
export function requestIdFrom(headers: Headers, make: () => string = () => crypto.randomUUID()): string {
  const sent = headers.get(REQUEST_ID_HEADER);
  return sent && REQUEST_ID.test(sent) ? sent : make();
}

/** On every answer: nothing may be cached (each answer is one person's data), and the type is what it says. */
export const RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

/** The same answer with the trace id and the headers above added. */
export function withGatewayHeaders(res: Response, requestId: string): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(RESPONSE_HEADERS)) headers.set(k, v);
  headers.set(REQUEST_ID_HEADER, requestId);
  // A browser page may read the id only when it is listed here.
  headers.set("Access-Control-Expose-Headers", REQUEST_ID_HEADER);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export type Body = { ok: true; text: string } | { ok: false; reason: "too_large" };

/**
 * The request body as text, read no further than `max` bytes. A declared length
 * over the cap is refused without reading; a body that keeps coming past it is
 * cut off as soon as it crosses.
 */
export async function readBody(req: Request, max = MAX_BODY_BYTES): Promise<Body> {
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > max) return { ok: false, reason: "too_large" };
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return { ok: false, reason: "too_large" };
    }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(all) };
}
