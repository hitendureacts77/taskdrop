import { type Fetch, UnknownOutcome } from "./types.ts";

/** Constant-time compare, so a wrong signature can't be guessed byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  return [...(await hmac(secret, message))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hmacBase64(secret: string, message: string): Promise<string> {
  return btoa(String.fromCharCode(...(await hmac(secret, message))));
}

export async function sha256Hex(message: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(message)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** HTML-escape for the tiny checkout pages. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** "UPI ••••@okhdfc" / "Bank ••1234": never the whole number. */
export function payeeHint(method: "upi" | "bank", upi?: string, accountNumber?: string): string {
  if (method === "upi") {
    const at = (upi ?? "").lastIndexOf("@");
    return at > 0 ? `UPI ••••${upi!.slice(at)}`.slice(0, 24) : "UPI";
  }
  const digits = (accountNumber ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `Bank ••${digits.slice(-4)}` : "Bank";
}

export type HttpAnswer = { status: number; body: Record<string, unknown> };

/**
 * One JSON call to a provider. A network failure or a 5xx is an UnknownOutcome (retry later with the same
 * key); a 4xx comes back as an answer for the adapter to read.
 */
export async function callJson(
  f: Fetch,
  url: string,
  init: { method: string; headers: Record<string, string>; body?: unknown },
): Promise<HttpAnswer> {
  let res: Response;
  try {
    res = await f(url, {
      method: init.method,
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new UnknownOutcome(`network: ${e instanceof Error ? e.message : String(e)}`);
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  if (res.status >= 500 || res.status === 429) throw new UnknownOutcome(`provider ${res.status}`);
  return { status: res.status, body };
}

/** The provider's own words for a refusal, short and with nothing personal in it. */
export function refusalNote(a: HttpAnswer): string {
  const err = (a.body.error ?? {}) as Record<string, unknown>;
  const msg = err.description ?? err.reason ?? a.body.message ?? a.body.code ?? `HTTP ${a.status}`;
  return String(msg).slice(0, 200);
}

export const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
export const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
