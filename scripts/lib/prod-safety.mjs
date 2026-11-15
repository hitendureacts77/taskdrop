/**
 * Production first-day checks and the outside safety alarm (plan task 5.9; holes H1, H3, H15, H21, H73; 2.18 part H).
 *
 * Pure on purpose: everything here takes values already read and returns findings, so the unit test
 * (scripts/prod-safety.test.mjs) can prove each bad state is caught without any connection. The two scripts that
 * read production are scripts/production-first-day.mjs (after a deploy) and scripts/production-alarm.mjs (hourly).
 *
 * A finding names a setting and why it is wrong, never a value. Levels:
 *   critical  a test shortcut or an open door on production. The deploy fails; the alarm sends Sentry a fatal event.
 *   warning   worth a look, not an emergency (a money setting the admin changed on purpose, a check that could not run).
 *
 * The Inngest job `safety-alarm` (supabase/functions/_shared/safetyAlarm.ts) checks the same shortcuts from inside the
 * project, where it can also read function-secret VALUES (a Razorpay test key held as a function secret). This file is
 * the outside half: it still fires when Inngest itself is not running, and it adds the doors the inside job cannot see.
 */

/** Function or Vault secrets that are test shortcuts. Superset of FORBIDDEN_IN_PRODUCTION in safetyAlarm.ts (the test checks). */
export const FORBIDDEN_SECRET_NAMES = [
  "ALLOW_ANY_OTP",
  "TEST_PHONES",
  "APP_CHECK_DEBUG_TOKEN",
  "EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN",
  "INNGEST_DEV",
];

/** Razorpay key ids whose kind is checked (only the 9-character prefix is ever read). */
export const RAZORPAY_KEY_NAMES = ["RAZORPAY_KEY_ID", "RAZORPAYX_KEY_ID"];

/**
 * "The settings production starts with" (docs/ULTIMATE_PLAN.md, task 5.9). Every value below is what the migrations
 * already write on a fresh database, so the first-day SQL does not set them; it only checks them. A difference is a
 * warning, because the admin may later change a money setting on purpose.
 */
export const EXPECTED_SETTINGS = {
  poster_service_fee_pct: 0.03,
  worker_commission_pct: 0.1,
  post_start_cancel_penalty_pct: 0.05,
  review_window_days: 3,
  clearing_period_days: 7,
  min_topup_minor: 5000,
  min_withdraw_minor: 10000,
  max_withdraw_minor: 10000000,
  max_video_seconds: 60,
  promotion_daily_budgets_minor: [5000, 8000, 15000, 30000],
  promotion_durations_days: [1, 3, 7],
  new_account_max_task_minor: 500000,
  new_account_max_withdraw_day_minor: 500000,
  new_account_days: 30,
  new_account_tasks: 3,
};
/** payout_method starts as "manual" (task 6.2 switches it to "razorpayx"); either is fine. */
export const PAYOUT_METHODS = ["manual", "razorpayx"];

/** Every settings key the state query reads. */
export const SETTINGS_KEYS = ["dev_otp_for_all", "admin_require_mfa", "payout_method", ...Object.keys(EXPECTED_SETTINGS)];

/** The gateway lockdown (supabase/lockdown/gateway_only.sql) as it shows in pg_roles.rolconfig for `authenticator`. */
export const GATEWAY_CONFIG = ["pgrst.db_pre_request=private.require_gateway", "pgrst.openapi_mode=disabled"];

/**
 * One read-only query that returns everything the database half needs, as one JSON object.
 * $1 = SETTINGS_KEYS, $2 = FORBIDDEN_SECRET_NAMES, $3 = RAZORPAY_KEY_NAMES.
 * From Vault it reads secret NAMES, and for the Razorpay key ids only the first 9 characters (rzp_live_ / rzp_test_).
 */
export const DB_STATE_SQL = `
select json_build_object(
  'settings', (select coalesce(json_object_agg(s.key, s.value), '{}'::json) from public.settings s where s.key = any($1::text[])),
  'environment', (select a.environment from public.app_controls a where a.platform = 'all'),
  'pg_graphql', exists (select 1 from pg_extension where extname = 'pg_graphql'),
  'anon_table_rights', (
    select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
       and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
            or has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))),
  'open_defaults', (
    select coalesce(json_agg(distinct d.defaclobjtype || ':' || a.grantee::regrole::text), '[]'::json)
      from pg_default_acl d cross join lateral aclexplode(d.defaclacl) a
     where d.defaclnamespace = 'public'::regnamespace and d.defaclrole = 'postgres'::regrole
       and ((d.defaclobjtype in ('r', 'f') and a.grantee in ('anon'::regrole::oid, 'authenticated'::regrole::oid))
            or (d.defaclobjtype = 'S' and a.grantee = 'anon'::regrole::oid))),
  'authenticator_config', (select coalesce(to_json(r.rolconfig), '[]'::json) from pg_roles r where r.rolname = 'authenticator'),
  'realtime_public_tables', (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'),
  'vault_forbidden', (select coalesce(json_agg(v.name), '[]'::json) from vault.secrets v where v.name = any($2::text[])),
  'razorpay_prefixes', (select coalesce(json_object_agg(v.name, left(v.decrypted_secret, 9)), '{}'::json) from vault.decrypted_secrets v where v.name = any($3::text[])),
  'gateway_secret', exists (select 1 from vault.secrets v where v.name = 'API_GATEWAY_SECRET')
) as state`;

export const dbStateParams = () => [SETTINGS_KEYS, FORBIDDEN_SECRET_NAMES, RAZORPAY_KEY_NAMES];

/**
 * Which functions need Supabase's login check, read from supabase/config.toml (`[functions.<slug>]` / `verify_jwt`).
 * A function not listed there gets Supabase's default, which is ON.
 */
export function expectedVerifyJwt(configToml, slugs) {
  const listed = {};
  let current = null;
  for (const raw of configToml.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const section = /^\[(.+)\]$/.exec(line);
    if (section) {
      current = /^functions\.([A-Za-z0-9_-]+)$/.exec(section[1])?.[1] ?? null;
      continue;
    }
    const v = /^verify_jwt\s*=\s*(true|false)$/.exec(line);
    if (current && v) listed[current] = v[1] === "true";
  }
  return Object.fromEntries(slugs.map((s) => [s, listed[s] ?? true]));
}

const isOff = (v) => v === false || v === "false";
const isOn = (v) => v === true || v === "true";
const sameValue = (actual, expected) =>
  Array.isArray(expected)
    ? Array.isArray(actual) && actual.length === expected.length && actual.every((x, i) => Number(x) === expected[i])
    : actual !== null && actual !== undefined && actual !== "" && Number(actual) === expected;

/** Findings from the database state (DB_STATE_SQL's object). */
export function judgeDatabase(db) {
  const out = [];
  const crit = (code, what) => out.push({ level: "critical", code, what });
  const warn = (code, what) => out.push({ level: "warning", code, what });
  const s = db?.settings ?? {};

  // Anything but an explicit off counts as on: a missing row must not read as safe (same rule as safetyAlarm.ts).
  if (!isOff(s.dev_otp_for_all)) crit("DEV_OTP_FOR_ALL_ON", "dev_otp_for_all is not off: any phone number could sign in with a code shown on screen (H1).");
  if (!isOn(s.admin_require_mfa)) crit("ADMIN_MFA_OFF", "admin_require_mfa is not on: admin money actions would not need the authenticator code.");
  if (db?.environment !== "production") crit("ENVIRONMENT_NOT_PRODUCTION", "The app environment setting is not 'production', so Razorpay test keys would be accepted and the staging ribbon shows.");
  if (db?.pg_graphql !== false) crit("PG_GRAPHQL_ON", "The pg_graphql extension is installed: the GraphQL door is open (2.18 H).");
  if (Number(db?.anon_table_rights) !== 0) crit("ANON_TABLE_RIGHTS", `Signed-out (anon) has rights on ${Number(db?.anon_table_rights) || "some"} public table(s); it must have none.`);
  if (!Array.isArray(db?.open_defaults) || db.open_defaults.length) crit("DEFAULT_PRIVILEGES_OPEN", "The database defaults would give new tables or functions to anon or authenticated (migrations 073, 156).");
  const cfg = Array.isArray(db?.authenticator_config) ? db.authenticator_config : [];
  for (const want of GATEWAY_CONFIG) {
    if (!cfg.includes(want)) crit("DIRECT_DOOR_OPEN", `The gateway lockdown is missing (${want.split("=")[0]}): the public key can reach the database directly (H3).`);
  }
  if (Number(db?.realtime_public_tables) !== 0) crit("LIVE_TABLE_BROADCASTS", "Public tables are in the supabase_realtime publication: live updates would reveal rows (gateway_only.sql).");
  for (const name of Array.isArray(db?.vault_forbidden) ? db.vault_forbidden : []) {
    crit(`${name}_SET`, `The Vault holds ${name}. It is a test shortcut and must not exist in production.`);
  }
  for (const [name, prefix] of Object.entries(db?.razorpay_prefixes ?? {})) {
    if (prefix === "rzp_test_") crit(`${name}_IS_TEST_KEY`, `${name} in the Vault is a Razorpay test key. Production must hold only live keys.`);
  }
  if (db?.gateway_secret !== true) crit("GATEWAY_SECRET_MISSING", "The Vault has no API_GATEWAY_SECRET, so the api function cannot pass the gateway.");

  for (const [key, expected] of Object.entries(EXPECTED_SETTINGS)) {
    if (!sameValue(s[key], expected)) warn(`SETTING_${key.toUpperCase()}`, `${key} differs from the production starting value in task 5.9 (fine if the admin changed it on purpose).`);
  }
  if (!PAYOUT_METHODS.includes(s.payout_method)) warn("SETTING_PAYOUT_METHOD", "payout_method is neither manual nor razorpayx.");
  return out;
}

/**
 * Findings from the Supabase Management API (secret NAMES, each function's login setting, the sign-in settings).
 * `platform` is null when no access token was given: that is one warning, not a pass.
 * `dashboardPending` turns the sign-in setting findings into warnings, for the deploy that runs before the owner's
 * dashboard clicks (the hourly alarm never sets it).
 */
export function judgePlatform(platform, expectedJwt, { dashboardPending = false } = {}) {
  if (!platform) {
    return [{ level: "warning", code: "PLATFORM_NOT_CHECKED", what: "No production access token: function secrets, function login settings and sign-in settings were not checked from outside (the Inngest safety-alarm still checks the secrets)." }];
  }
  const out = [];
  const crit = (code, what) => out.push({ level: "critical", code, what });
  const warn = (code, what) => out.push({ level: "warning", code, what });
  const authLevel = dashboardPending ? warn : crit;

  const names = new Set(platform.secretNames ?? []);
  for (const name of FORBIDDEN_SECRET_NAMES) {
    if (names.has(name)) crit(`${name}_SET`, `The function secret ${name} is set. It is a test shortcut and must not exist in production.`);
  }

  const deployed = new Map((platform.functions ?? []).map((f) => [f.slug, f]));
  for (const [slug, want] of Object.entries(expectedJwt)) {
    const f = deployed.get(slug);
    if (!f) crit(`FUNCTION_MISSING_${slug}`, `The function ${slug} is not deployed.`);
    else if (f.verify_jwt !== want) crit(`VERIFY_JWT_${slug}`, `${slug} has the login check ${f.verify_jwt ? "on" : "off"}; the code (supabase/config.toml) says ${want ? "on" : "off"} (H73).`);
  }
  for (const slug of deployed.keys()) {
    if (!(slug in expectedJwt)) warn(`FUNCTION_EXTRA_${slug}`, `The function ${slug} is deployed but is not in supabase/functions.`);
  }

  const auth = platform.auth;
  if (!auth || typeof auth !== "object") {
    warn("AUTH_NOT_CHECKED", "The sign-in settings could not be read.");
  } else {
    const unknown = (k) => !(k in auth);
    if (unknown("hook_before_user_created_enabled")) warn("AUTH_HOOK_UNKNOWN", "The sign-up guard hook setting was not in the answer; check it in the dashboard.");
    else if (auth.hook_before_user_created_enabled !== true || !String(auth.hook_before_user_created_uri ?? "").endsWith("/public/hook_before_user_created")) {
      authLevel("SIGNUP_GUARD_HOOK_OFF", "The sign-up guard hook (Before User Created -> hook_before_user_created) is not on: anyone can create an email account directly (H21).");
    }
    if (auth.external_anonymous_users_enabled === true) authLevel("ANONYMOUS_SIGN_IN_ON", "Supabase's anonymous sign-in is on; production keeps it off.");
    if (auth.external_phone_enabled === true) authLevel("SUPABASE_PHONE_SIGN_IN_ON", "Supabase's own phone sign-in is on; TaskDrop signs in phones through phone-auth only.");
  }
  return out;
}

export const criticalOf = (findings) => findings.filter((f) => f.level === "critical");

/** One line for Sentry and the logs: codes only, never a value. */
export function alarmLine(findings) {
  return `production safety alarm (outside check): ${criticalOf(findings).map((f) => f.code).join(", ")}`;
}

// ---------------------------------------------------------------- Sentry --

/**
 * Splits a Sentry DSN (https://<public key>@<host>/<project id>) into what the envelope endpoint needs.
 * Returns null for anything else, so a bad DSN fails loudly instead of sending nowhere.
 */
export function parseDsn(dsn) {
  let u;
  try {
    u = new URL(String(dsn ?? "").trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || !u.username) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const projectId = parts.pop();
  if (!projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = parts.length ? `/${parts.join("/")}` : "";
  return {
    publicKey: decodeURIComponent(u.username),
    endpoint: `https://${u.host}${prefix}/api/${projectId}/envelope/`,
  };
}

/** A Sentry envelope holding one fatal event. Grouped by the set of codes, so a new kind of problem is a new issue (and a new email). */
export function sentryEnvelope(findings, { eventId, now = new Date(), runUrl } = {}) {
  const codes = criticalOf(findings).map((f) => f.code).sort();
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    level: "fatal",
    platform: "node",
    logger: "production-alarm",
    environment: "production",
    message: { formatted: alarmLine(findings) },
    tags: { source: "github-production-alarm", task: "5.9" },
    fingerprint: ["production-safety-alarm", ...codes],
    extra: { findings: criticalOf(findings).map((f) => ({ code: f.code, what: f.what })), run: runUrl ?? null },
  };
  return `${JSON.stringify({ event_id: eventId, sent_at: now.toISOString() })}\n${JSON.stringify({ type: "event" })}\n${JSON.stringify(event)}\n`;
}

/** Sends the envelope. Throws on a bad DSN or a refused send, so the job fails either way. Never prints the DSN. */
export async function sendToSentry(dsn, findings, { fetchImpl = fetch, eventId, runUrl } = {}) {
  const target = parseDsn(dsn);
  if (!target) throw new Error("PROD_SENTRY_DSN is missing or not a Sentry DSN.");
  const id = eventId ?? crypto.randomUUID().replace(/-/g, "");
  const res = await fetchImpl(target.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-sentry-envelope",
      "X-Sentry-Auth": `Sentry sentry_version=7, sentry_key=${target.publicKey}, sentry_client=taskdrop-production-alarm/1.0`,
    },
    body: sentryEnvelope(findings, { eventId: id, runUrl }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Sentry refused the alarm (HTTP ${res.status}).`);
  return id;
}
