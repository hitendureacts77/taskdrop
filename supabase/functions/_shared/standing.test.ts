// node --experimental-strip-types --test supabase/functions/_shared/standing.test.ts
// The standing check, the dev-mode guard and the money-door wiring from the security hunt (task 2.14, round 2).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { devModeAllowed } from "./devMode.ts";
import { mustRefuse, standingOf } from "./standing.ts";

/** A reader that answers the two lookups with the given rows. */
function reader(o: { suspended?: boolean; deletedAt?: string | null; noProfile?: boolean; fail?: boolean }) {
  const q = (result: () => { data: unknown; error: unknown }) => {
    const p: unknown = new Proxy(function () {}, {
      get(_t, name) {
        if (name === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(result()).then(res, rej);
        return () => p;
      },
    });
    return p;
  };
  const error = o.fail ? { message: "db down" } : null;
  return {
    from: (table: string) =>
      table === "user_suspensions"
        ? q(() => ({ data: o.suspended ? [{ id: "s" }] : [], error }))
        : q(() => ({ data: o.noProfile ? null : { deleted_at: o.deletedAt ?? null }, error })),
  };
}

test("standing: ok, suspended, deleted, and unreadable is not a verdict", async () => {
  assert.equal(await standingOf(reader({}), "u"), "ok");
  assert.equal(await standingOf(reader({ suspended: true }), "u"), "suspended");
  assert.equal(await standingOf(reader({ deletedAt: "2026-11-01T00:00:00Z" }), "u"), "deleted");
  assert.equal(await standingOf(reader({ noProfile: true }), "u"), "deleted");
  assert.equal(await standingOf(reader({ fail: true }), "u"), null);
});

test("only a suspended or deleted person is refused; an unreadable standing goes ahead", () => {
  assert.equal(mustRefuse("suspended"), true);
  assert.equal(mustRefuse("deleted"), true);
  assert.equal(mustRefuse("ok"), false);
  assert.equal(mustRefuse(null), false);
});

test("dev mode (no signature check) is allowed on staging and localhost only", () => {
  assert.equal(devModeAllowed("https://wjxvingpfbfvkfqhrguj.supabase.co"), true);
  assert.equal(devModeAllowed("http://localhost:54321"), true);
  assert.equal(devModeAllowed("http://127.0.0.1:54321"), true);
  assert.equal(devModeAllowed("https://abcdefghijklmnopqrst.supabase.co"), false, "any other project, such as production");
  assert.equal(devModeAllowed("https://wjxvingpfbfvkfqhrguj.supabase.co.evil.test"), false, "a look-alike host");
  assert.equal(devModeAllowed("https://evil.test/wjxvingpfbfvkfqhrguj.supabase.co"), false);
  assert.equal(devModeAllowed(undefined), false);
  assert.equal(devModeAllowed("not a url"), false);
});

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

test("the inngest function refuses to start in dev mode outside staging", () => {
  const src = read("inngest/index.ts");
  assert.ok(src.includes("if (dev && !devModeAllowed(Deno.env.get(\"SUPABASE_URL\")))"));
  assert.ok(src.indexOf("devModeAllowed(") < src.indexOf("new Inngest("), "the refusal comes before the client is built");
});

test("razorpay, razorpayx-payouts and places-search refuse suspended or deleted people", () => {
  for (const f of ["razorpay", "razorpayx-payouts", "places-search"]) {
    const src = read(`${f}/index.ts`);
    assert.ok(src.includes("standingOf(admin,"), `${f} asks for the standing`);
    assert.ok(src.includes("mustRefuse(standing)"), `${f} refuses on it`);
  }
});

test("staff money actions ask the database, as the caller, for money staff with the authenticator code", () => {
  const rzp = read("razorpay/index.ts");
  assert.ok(rzp.includes('asUser.rpc("check_money_staff")'));
  assert.ok(rzp.indexOf('asUser.rpc("check_money_staff")') < rzp.indexOf('asUser.rpc("escrow_refund_due"'), "before the refund is worked out");
  assert.ok(rzp.includes("taskRow!.poster_id !== userId"), "a poster refunding their own task is not asked");
  assert.ok(rzp.includes('p_action: "escrow_refund"'), "a staff refund is audited");

  const x = read("razorpayx-payouts/index.ts");
  assert.equal((x.match(/await moneyStaffRefusal\(\)/g) ?? []).length, 4, "send for someone else, check-all, give-back, balance");
  assert.ok(x.includes('p_action: "payout_give_back"'), "a give-back is audited");
});

test("a paid payment whose task is not funded is funded again, by sync and by the webhook", () => {
  const rzp = read("razorpay/index.ts");
  assert.ok(/if \(!funded && row\.purpose === "escrow" && row\.task_id\) \{\s*await fundTask/.test(rzp));
  const hook = read("razorpay-webhook/index.ts");
  assert.ok(/if \(t && !t\.funded_at\) \{\s*const \{ error: fundErr \} = await admin\.rpc\("fund_task_from_payment"/.test(hook));
});

test("create-link hands back an open link for the same task and amount", () => {
  const rzp = read("razorpay/index.ts");
  const reuse = rzp.indexOf("reused: true");
  assert.ok(reuse > 0 && reuse < rzp.indexOf("`${RZP}/payment_links`"), "looked for before a new link is asked for");
  assert.ok(rzp.includes('.eq("status", "created")') && rzp.includes('.eq("amount_minor", amount)'));
});
