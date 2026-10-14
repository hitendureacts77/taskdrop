import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.116.0";
import { Inngest } from "npm:inngest@4.23.0";
import { serve } from "npm:inngest@4.23.0/edge";
import { captureServerError } from "../_shared/monitoring.ts";
import {
  ALERT_EVENTS,
  alertFor,
  safeData,
  call,
  digestAlert,
  type Digest,
  type OutboxRow,
  saveAlert,
  toEvents,
} from "./jobs.ts";

/**
 * Inngest, served from a Supabase Edge Function.
 *
 * Inngest calls this URL (https://<ref>.supabase.co/functions/v1/inngest) to
 * run TaskDrop's scheduled and event-driven jobs, step by step, with retries.
 * Every request is verified against INNGEST_SIGNING_KEY by the SDK, which is why
 * config.toml turns the platform's JWT check off for this one function.
 *
 * Postgres decides and Inngest carries out. These functions never compute a
 * price, a fee or a balance: they move events out of the outbox, ask the
 * database to run its own sweeps, and leave messages for the team in
 * admin_alerts. See docs/INNGEST.md.
 *
 * Secrets (supabase secrets set ...):
 *   INNGEST_SIGNING_KEY   verifies that calls really come from Inngest
 *   INNGEST_EVENT_KEY     lets this function send events
 *   INNGEST_MONEY_JOBS    "on" to let Inngest run the three money sweeps (default off)
 *   INNGEST_DEV           "1" when talking to a local `inngest-cli dev` server
 */

const dev = Deno.env.get("INNGEST_DEV") === "1";

const inngest = new Inngest({
  id: "taskdrop",
  signingKey: Deno.env.get("INNGEST_SIGNING_KEY"),
  eventKey: Deno.env.get("INNGEST_EVENT_KEY"),
  isDev: dev,
  // Edge Functions are short-lived; every step is its own request.
  checkpointing: false,
});

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);
const rpc = (name: string, args?: Record<string, unknown>) => db.rpc(name, args);

/** After the last retry, tell Sentry (if configured). */
const reportFailure = (job: string) => async ({ error }: { error: unknown }) => {
  await captureServerError(error, { job });
};

// ---------------------------------------------------------------- the outbox --

/**
 * Re-sends events the fast path (pg_net) did not get through. Runs every
 * minute. The outbox id is the event id, so one that did arrive is dropped as a
 * duplicate rather than run twice.
 */
const outboxSweeper = inngest.createFunction(
  { id: "outbox-sweeper", triggers: [{ cron: "* * * * *" }], concurrency: 1, onFailure: reportFailure("outbox-sweeper") },
  async ({ step }) => {
    const rows = await step.run("load unsent", () => call<OutboxRow[]>(rpc, "outbox_pending", { p_limit: 200 }));
    if (!rows || rows.length === 0) return { forwarded: 0 };

    await step.sendEvent("forward", toEvents(rows));
    await step.run("mark sent", () => call<number>(rpc, "outbox_mark_sent", { p_ids: rows.map((r) => r.id) }));
    return { forwarded: rows.length };
  },
);

/** Sent events are kept two weeks for debugging. */
const outboxPrune = inngest.createFunction(
  { id: "outbox-prune", triggers: [{ cron: "TZ=Asia/Kolkata 15 4 * * *" }], onFailure: reportFailure("outbox-prune") },
  async ({ step }) => ({ pruned: await step.run("prune", () => call<number>(rpc, "outbox_prune")) }),
);

// -------------------------------------------------------------- team alerts --

/** A help request, a withdrawal, a failed payout or a dispute becomes a message for the team. */
const teamAlert = inngest.createFunction(
  { id: "team-alert", triggers: ALERT_EVENTS.map((event) => ({ event })), onFailure: reportFailure("team-alert") },
  async ({ event, step }) => {
    const alert = alertFor(event.name, event.data ?? {});
    if (!alert) return { skipped: true };
    const id = await step.run("save alert", () => saveAlert(rpc, alert, safeData(event.data ?? {})));
    return { alert: id };
  },
);

/** Totals only, every morning at 9:00 India time. */
const dailyDigest = inngest.createFunction(
  { id: "daily-digest", triggers: [{ cron: "TZ=Asia/Kolkata 0 9 * * *" }], onFailure: reportFailure("daily-digest") },
  async ({ step }) => {
    const totals = await step.run("collect totals", () => call<Digest>(rpc, "daily_digest"));
    const id = await step.run("save digest", () => saveAlert(rpc, digestAlert(totals), totals));
    return { alert: id };
  },
);

// -------------------------------------------------------------- money sweeps --

/**
 * The three money sweeps. The rules live in Postgres (auto_complete_due,
 * settle_cleared_earnings, settle_finished_campaigns); these only ring the bell
 * on a schedule. They stay OFF until INNGEST_MONEY_JOBS=on, because pg_cron
 * runs them today. All three are safe to run twice, so a short overlap while
 * switching over cannot pay anyone twice. See supabase/cutover/.
 */
function sweep(id: string, cron: string, fn: string) {
  return inngest.createFunction(
    { id, triggers: [{ cron }], concurrency: 1, retries: 4, onFailure: reportFailure(id) },
    async ({ step }) => ({ [fn]: await step.run(fn, () => call<number>(rpc, fn)) }),
  );
}

const moneyJobs = Deno.env.get("INNGEST_MONEY_JOBS") === "on"
  ? [
    sweep("auto-complete-due", "*/15 * * * *", "run_auto_complete_due"),
    sweep("settle-cleared-earnings", "*/5 * * * *", "settle_cleared_earnings"),
    sweep("settle-finished-campaigns", "7 * * * *", "settle_finished_campaigns"),
  ]
  : [];

Deno.serve(serve({
  client: inngest,
  functions: [outboxSweeper, outboxPrune, teamAlert, dailyDigest, ...moneyJobs],
  servePath: "/functions/v1/inngest",
}));
