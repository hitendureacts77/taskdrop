/**
 * Compatibility check: does the `api` function still serve the OLD app?
 *
 * Until Phase 9 the old app (`main`) and the upgrade share one database and one
 * `api` function, so a change that suits the upgrade can break the old app. This
 * runs the operations the old app calls through BOTH versions of the function --
 * the one on `main` and the one in this checkout -- against the same fake
 * database, and fails when the new version:
 *
 *   - no longer knows an operation the old app calls
 *   - refuses arguments the old version accepted (a new required field, a tighter limit)
 *   - answers with fewer fields than before (a dropped or renamed field)
 *
 * Adding operations, optional arguments and extra response fields is fine.
 * The old app's operations and their argument names are read from its own source,
 * so nobody has to keep a list by hand.
 *
 *   OLD_APP_DIR=<a checkout of main> npm run test:contract
 *   npm run test:contract            (extracts `main` from git into a temp folder)
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { oldAppDir } from "../../../scripts/lib/old-app.mjs";
import { NEVER_REUSE, PER_PERSON_REUSE } from "../../../apps/mobile/src/lib/freshness.ts";
import { GUEST_OPS } from "./guest.ts";
import { OPS as NEW_OPS, rateBucket, runOp as runNew } from "./ops.ts";
import { MEMO_MAX_TTL_MS, MEMO_MIN_TTL_MS, PUBLIC_MEMO_OPS, isPublicMemoOp, memoKey, memoTtlMs } from "./publicMemo.ts";
import { READ_OPS } from "./reads.ts";

const REPO = resolve(import.meta.dirname, "../../..");
const UID = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

// ------------------------------------- closed caching lists (task 3.5b E) --
// Runs first and needs no old app: what may be shared between people, what
// is never reused, and that every api op is one of them by a conscious choice.
{
  const memo = Object.keys(PUBLIC_MEMO_OPS);
  const known = new Set([...Object.keys(NEW_OPS), "batch"]);
  const reads = Object.keys(NEW_OPS).filter((op) => rateBucket(op) === "read");
  const writes = Object.keys(NEW_OPS).filter((op) => rateBucket(op) !== "read");
  const lists = { PUBLIC_MEMO_OPS: memo, NEVER_REUSE: [...NEVER_REUSE], PER_PERSON_REUSE: [...PER_PERSON_REUSE] };
  const problems: string[] = [];

  // Every name on a list is a real op (a typo would leave the real op unguarded).
  for (const [list, names] of Object.entries(lists)) {
    for (const op of names) if (!known.has(op)) problems.push(`${list} names ${op}, which is not an api op`);
  }

  // No op on two lists.
  const seen = new Map<string, string>();
  for (const [list, names] of Object.entries(lists)) {
    for (const op of names) {
      if (seen.has(op)) problems.push(`${op} is on both ${seen.get(op)} and ${list}`);
      else seen.set(op, list);
    }
  }

  // Every read is classified (a new op forces a choice); writes are never reused.
  for (const op of reads) if (!seen.has(op)) problems.push(`${op} is a new api read on no caching list: add it to PUBLIC_MEMO_OPS, NEVER_REUSE or PER_PERSON_REUSE`);
  for (const op of writes) {
    if (isPublicMemoOp(op) || PER_PERSON_REUSE.has(op)) problems.push(`${op} is a write and may never be reused`);
  }

  // The shared list holds only same-for-everyone reads.
  const neverShared = new Set([
    // money
    "getWallet", "getEscrowHeld", "listWalletActivity", "listPayouts", "listPayoutDestinations", "feesSince",
    "platformFees", "settleClearedEarnings", "myStats", "listPromotions",
    // task status and offers
    "getTask", "getTaskDetail", "canQuoteOn", "getMyBid", "listBidsForTask", "listMyBids", "countBidsByTask",
    "listMyTasks", "listMyAssignments", "getProof", "countNeedsAttention",
    // chat, contacts, notifications
    "listMessages", "listThreads", "listCrewMessages", "taskContactPhone", "countUnreadFor", "getNotification",
    "listNotifications", "countUnreadNotifications",
    // admin and account state
    "isAdmin", "platformStats", "accountDeletionCheck", "ageStatus",
  ]);
  const sensitiveName = (op: string) =>
    /wallet|escrow|payout|fee|earning|bid|quote|proof|message|thread|chat|contact|phone|notification|admin|stats|dispute|ticket|unread|attention/i.test(op) ||
    /^my[A-Z]|^getTask|^listMy/.test(op);
  for (const op of memo) {
    if (NEVER_REUSE.has(op)) problems.push(`${op} is on PUBLIC_MEMO_OPS and NEVER_REUSE`);
    if (neverShared.has(op)) problems.push(`${op} is a money, task, offer, chat, contact or admin read and may never be shared`);
    if (sensitiveName(op)) problems.push(`${op} looks like a personal or money read (name) and may never be shared`);
    if (rateBucket(op) !== "read") problems.push(`${op} is not a read`);
    // The same op a guest gets (it runs with no person behind it), or the one
    // reviewed exception: promotionTiers reads settings rows every signed-in person may read.
    if (GUEST_OPS[op] !== READ_OPS[op] && op !== "promotionTiers") problems.push(`${op} is not one of the guest's shared reads`);
    const ttl = memoTtlMs(op);
    if (ttl === null || ttl < MEMO_MIN_TTL_MS || ttl > MEMO_MAX_TTL_MS) problems.push(`${op} keeps its answer ${ttl} ms, outside 15 to 60 s`);
  }
  assert.deepEqual(problems, [], `caching lists are wrong:\n  ${problems.join("\n  ")}`);

  // The helpers: nothing off the list is shared, and the key is the op plus sorted arguments.
  assert.equal(memoTtlMs("getWallet"), null);
  assert.equal(memoTtlMs("toString"), null);
  assert.equal(isPublicMemoOp("__proto__"), false);
  assert.equal(memoKey("topEarners", { limit: 10, kind: "top_rated" }), memoKey("topEarners", { kind: "top_rated", limit: 10 }));
  assert.equal(memoKey("topEarners", { kind: "top_rated", limit: 10 }), 'topEarners:{"kind":"top_rated","limit":10}');
  assert.notEqual(memoKey("topEarners", { kind: "top_rated" }), memoKey("topEarners", { kind: "most_active" }));
  assert.equal(memoKey("platformHighlights", undefined), "platformHighlights:{}");
  assert.equal(memoKey("trendingCategories", { a: { y: 1, x: [2, { b: 1, a: 0 }] } }), 'trendingCategories:{"a":{"x":[2,{"a":0,"b":1}],"y":1}}');
  console.log(`ok  - caching lists: ${memo.length} shared, ${NEVER_REUSE.size} never reused, ${PER_PERSON_REUSE.size} per person; ${reads.length} reads all classified`);
}

const OLD = oldAppDir(REPO);
const oldApi = (await import(pathToFileURL(join(OLD, "supabase/functions/api/ops.ts")).href)) as typeof import("./ops.ts");

// ------------------------------------------- what the old app asks for ----

/** Everything between the `{` at `start` and its matching `}`; null if unbalanced. */
function balanced(src: string, start: number): string | null {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  return null;
}

/** The index just after the `>` that closes the `<` at `start` (type arguments, which may contain `=>`). */
function afterAngles(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "<") depth++;
    else if (src[i] === ">" && src[i - 1] !== "=" && --depth === 0) return i + 1;
  }
  return start;
}

/** Top-level keys of an object literal's body: `a: 1, b, ...c` -> ["a", "b"]. */
function topKeys(body: string): string[] {
  const keys: string[] = [];
  let depth = 0, part = "";
  const flush = () => {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(part);
    if (m && !part.trim().startsWith("...")) keys.push(m[1]);
    part = "";
  };
  for (const c of body) {
    if ("{[(".includes(c)) depth++;
    if ("}])".includes(c)) depth--;
    if (c === "," && depth === 0) flush();
    else part += c;
  }
  flush();
  return keys;
}

function askedByOldApp(): Map<string, Set<string>> {
  const asked = new Map<string, Set<string>>();
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(f)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/\b(?:act|ask|quietly|callApi)(?=[<(])/g)) {
          let i = m.index! + m[0].length;
          if (src[i] === "<") i = afterAngles(src, i);
          const call = /^\(\s*'([A-Za-z]+)'\s*(,\s*)?/.exec(src.slice(i, i + 80));
          if (!call) continue;
          const keys = asked.get(call[1]) ?? new Set<string>();
          asked.set(call[1], keys);
          const at = i + call[0].length;
          if (call[2] && src[at] === "{") for (const k of topKeys(balanced(src, at) ?? "")) keys.add(k);
        }
      }
    }
  };
  walk(join(OLD, "apps/mobile/src"));
  return asked;
}

/** A believable value for an argument, guessed from its name. A wrong guess is refused by both versions alike. */
function sample(key: string): unknown {
  if (/Ids$/.test(key)) return [ID];
  if (/Id$/.test(key) || key === "id") return ID;
  if (key === "rating") return 5;
  if (key === "days") return 3;
  if (key === "limit") return 20;
  if (key === "lat") return 17.44;
  if (key === "lng") return 78.35;
  if (key === "kind") return "request";
  if (key === "birthDate") return "1990-01-01";
  if (key === "near") return { lat: 17.44, lng: 78.35, radiusKm: 10 };
  if (/Minor$|Minutes$|^offset$|^radiusKm$|^count$/.test(key)) return 100;
  if (/^(is|has|only|enabled)[A-Z]|^(accepted|read|seen)$/.test(key)) return true;
  return "test";
}

// ---------------------------------------------------------------- running --

type Reply = { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };

/** A fake database that answers every query with one plain row, like the api tests' default. */
function fakeDb() {
  const row = { id: ID, poster_id: UID, worker_id: UID, user_id: UID, task_id: ID, status: "OPEN" };
  const reply = { data: [row], error: null };
  const chain = (): unknown =>
    new Proxy(function () {}, {
      get: (_t, name) => (name === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(reply).then(res) : () => chain()),
    });
  return {
    from: () => chain(),
    rpc: async () => reply,
    storage: { from: () => ({ createSignedUploadUrl: async () => ({ data: { signedUrl: "https://x" }, error: null }), createSignedUrls: async () => ({ data: [], error: null }), remove: async () => ({ data: null, error: null }) }) },
  };
}

const ctx = () => ({ db: fakeDb() as never, userId: UID, now: () => new Date("2026-10-05T10:00:00Z") });

/** Every key in `old` must still be in `now`, at any depth. Returns the missing paths. */
function missingKeys(old: unknown, now: unknown, path = ""): string[] {
  if (Array.isArray(old)) return old.length && Array.isArray(now) && now.length ? missingKeys(old[0], now[0], path + "[]") : [];
  if (old && typeof old === "object") {
    if (!now || typeof now !== "object" || Array.isArray(now)) return [path || "(response)"];
    return Object.entries(old).flatMap(([k, v]) => (k in now ? missingKeys(v, (now as Record<string, unknown>)[k], `${path}.${k}`) : [`${path}.${k}`]));
  }
  return [];
}

const asked = askedByOldApp();
assert.ok(asked.size > 80, `found only ${asked.size} operations in the old app; the scan is broken`);

const problems: string[] = [];
let compared = 0, answered = 0;
for (const [op, keys] of [...asked].sort()) {
  if (!Object.prototype.hasOwnProperty.call(NEW_OPS, op)) {
    problems.push(`${op}: the old app calls it, but this version has no such operation`);
    continue;
  }
  const args = Object.fromEntries([...keys].map((k) => [k, sample(k)]));
  const before = (await oldApi.runOp(op, args, ctx() as never)) as Reply;
  const now = (await runNew(op, args, ctx() as never)) as Reply;
  compared++;
  if (before.ok) {
    answered++;
    if (!now.ok) problems.push(`${op}: used to accept ${JSON.stringify(args)}, now refuses it with ${now.error.code} ("${now.error.message}")`);
    else {
      const gone = missingKeys(before.data, now.data);
      if (gone.length) problems.push(`${op}: the answer lost fields: ${gone.join(", ")}`);
    }
  } else if (now.ok === false && now.error.code !== before.error.code && before.error.code !== "BAD_ARGS") {
    problems.push(`${op}: used to fail with ${before.error.code}, now fails with ${now.error.code}`);
  }
}

console.log(`old app asks for ${asked.size} operations; compared ${compared}; ${answered} of them answered by the old version with the sample arguments`);
assert.ok(answered > 20, `only ${answered} operations reached an answer; the sample arguments are broken`);
assert.deepEqual(problems, [], `the new api would break the old app:\n  ${problems.join("\n  ")}`);
console.log("ok  - the api still serves everything the old app asks for");
