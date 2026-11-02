/**
 * Repeat keys (idempotency keys): a write sent twice is done once.
 *
 * The app sends `Idempotency-Key: <random id>` with a write, made once per tap
 * and kept when it has to send that write again (a dropped connection, a
 * double tap). The first request with a key runs and its reply is saved
 * (migration 139); any later request with the same key gets that same reply
 * back and does nothing. A key is one person's: two people can never collide.
 *
 * A call without a key runs exactly as before (the old app sends none).
 *
 * No Deno imports on purpose, so the tests run from Node.
 */

import type { Reply } from "./ops.ts";

export const REPEAT_KEY_HEADER = "idempotency-key";

/** Set on an answer that was saved from an earlier request instead of being worked out again. */
export const REPLAYED_HEADER = "idempotent-replayed";

const REPEAT_KEY = /^[A-Za-z0-9_-]{16,64}$/;

/** The key the app sent: null when there is none, "bad" when it is not shaped like one. */
export function repeatKeyFrom(headers: Headers): string | null | "bad" {
  const sent = headers.get(REPEAT_KEY_HEADER);
  if (sent === null || sent === "") return null;
  return REPEAT_KEY.test(sent) ? sent : "bad";
}

/** JSON with every object's keys in order, so the same request always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? "null" : stableJson(v))).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** What the request asked for, as a short fingerprint: a key sent again with different arguments is refused. */
export async function requestHash(op: string, args: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(`${op}\n${stableJson(args)}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What api_repeat_claim answered (migration 139). */
export type Claim =
  | { state: "new" }
  | { state: "done"; reply: Reply }
  | { state: "running" }
  | { state: "lost" }
  | { state: "mismatch" };

/** Where keys are kept: the database, through the service key, in production. */
export type RepeatStore = {
  claim(key: string, op: string, hash: string): Promise<Claim>;
  save(key: string, reply: Reply): Promise<void>;
};

export type Outcome = { reply: Reply; status: number; replayed: boolean };

const refusal = (message: string, code: string): Reply => ({ ok: false, error: { message, code, details: null } });

/** The first request with this key is still running. The app waits a moment and asks again with the same key. */
export const IN_PROGRESS = refusal("That is still going through. Please wait a moment.", "IN_PROGRESS");
/** The key was already used for a different request: a fault in the app, never something a person did. */
export const KEY_REUSED = refusal("Something went wrong. Please try again.", "KEY_REUSED");
/** The first request stopped before its answer was saved, so nobody knows whether it went through. */
export const OUTCOME_UNKNOWN = refusal(
  "We could not confirm whether that went through. Please check before trying again.",
  "OUTCOME_UNKNOWN",
);

/**
 * Run a write at most once per key. Every reply the write gives is saved, a
 * refusal included, so a repeat gets exactly what the first request got.
 *
 * If the store cannot be reached the write runs anyway, as it did before keys
 * existed: an outage of this check must not become an outage of the app, and
 * the money rules in SQL still refuse a second payment on their own.
 */
export async function runOnce(
  store: RepeatStore,
  key: string,
  op: string,
  args: unknown,
  run: () => Promise<Reply>,
  onStoreError: (e: unknown) => void = () => {},
): Promise<Outcome> {
  let claim: Claim | null = null;
  try {
    claim = await store.claim(key, op, await requestHash(op, args));
  } catch (e) {
    onStoreError(e);
  }
  switch (claim?.state) {
    case "done":
      return { reply: claim.reply, status: 200, replayed: true };
    case "running":
      return { reply: IN_PROGRESS, status: 409, replayed: false };
    case "mismatch":
      return { reply: KEY_REUSED, status: 422, replayed: false };
    case "lost":
      return { reply: OUTCOME_UNKNOWN, status: 200, replayed: false };
  }
  const reply = await run();
  if (claim?.state === "new") {
    try {
      await store.save(key, reply);
    } catch (e) {
      onStoreError(e);
    }
  }
  return { reply, status: 200, replayed: false };
}
