import pg from "pg";

/** The shared cloud test project (ground rule 8 in docs/UPGRADE_PLAN.md). */
export const TEST_PROJECT = "wjxvingpfbfvkfqhrguj";

/**
 * The production project (plan task 5.9). It is reachable only through the narrow path in
 * `productionAllowed` below, and only by a caller that also passes `{ production: true }` to withDb.
 */
export const PRODUCTION_PROJECT = "dyzskuzqcqbexssyrrxc";

/**
 * The documented escape hatch for running a production script from a laptop instead of GitHub Actions
 * (an emergency, with the owner watching). Its value is a sentence on purpose, so it cannot be set by
 * accident. docs/PRODUCTION_GO.md explains when it may be used.
 */
export const LOCAL_OVERRIDE_NAME = "TASKDROP_PRODUCTION_FROM_LAPTOP";
export const LOCAL_OVERRIDE_VALUE = "yes, this is production";

/**
 * The Supabase project ref a connection string points at, or null: the direct host `db.<ref>.supabase.co`,
 * or a pooler host (`*.pooler.supabase.com`) with the user `postgres.<ref>`. Exact matches only, never a name
 * that merely contains a ref.
 */
export function projectRefOf(url) {
  const u = new URL(url);
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
  if (direct) return direct[1];
  if (u.hostname.endsWith(".pooler.supabase.com")) {
    const user = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(u.username));
    if (user) return user[1];
  }
  return null;
}

/**
 * Whether the environment opens the production path. All of these must hold:
 *   - PRODUCTION_DEPLOY is exactly "1";
 *   - the script runs in GitHub Actions (GITHUB_ACTIONS=true), where the secrets live in the
 *     `production-database` / `production-backup` environments, or the laptop override is set word for word.
 * The ref check is separate (targetKind), so a right flag with a wrong address is still refused.
 */
export function productionAllowed(env = process.env) {
  if (env.PRODUCTION_DEPLOY !== "1") return false;
  return env.GITHUB_ACTIONS === "true" || env[LOCAL_OVERRIDE_NAME] === LOCAL_OVERRIDE_VALUE;
}

/**
 * What a connection string points at: "local", "test" (the shared cloud test project), "production", or null.
 *
 * Staging and production can never be mixed:
 *   - with PRODUCTION_DEPLOY=1 set, ONLY the production project is accepted (localhost and staging are refused),
 *     so a production run handed the staging address stops instead of "deploying" to staging;
 *   - without it (or outside GitHub Actions without the override), production is refused like any other host.
 */
export function targetKind(url, env = process.env) {
  const u = new URL(url);
  const host = u.hostname;
  const ref = projectRefOf(url);
  if (env.PRODUCTION_DEPLOY === "1") {
    return productionAllowed(env) && ref === PRODUCTION_PROJECT ? "production" : null;
  }
  if (["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) return "local";
  if (ref === TEST_PROJECT) return "test";
  return null;
}

/** Why a URL is refused, in words (no password). */
export function refusalReason(url, env = process.env) {
  if (env.PRODUCTION_DEPLOY === "1") {
    if (!productionAllowed(env)) return `PRODUCTION_DEPLOY=1 is only honoured in GitHub Actions (or with ${LOCAL_OVERRIDE_NAME} set as docs/PRODUCTION_GO.md says).`;
    return `PRODUCTION_DEPLOY=1 accepts only the production project (${PRODUCTION_PROJECT}); ${describeTarget(url)} is not it.`;
  }
  return `only localhost and the test project (${TEST_PROJECT}) are allowed.`;
}

/**
 * Runs SQL against the database in DATABASE_URL with the `pg` driver, so the deploy and
 * seed scripts work on any machine (no psql needed). A file with several statements
 * goes through the simple query protocol as one call.
 *
 * Refuses any target but localhost or the test project, so these scripts can't be pointed at
 * production by a wrong DATABASE_URL. Production needs BOTH the environment gate in targetKind
 * and the caller's own `{ production: true }`: a seed or reset script never passes it, so even a
 * fully configured production job cannot run one of them against production.
 *
 * Remote connections are encrypted. The server's certificate is checked only when
 * DATABASE_CA_CERT holds Supabase's root CA (PEM): that CA is not in the default trust store,
 * so verifying by default would reject every Supabase connection.
 */
export async function withDb(url, fn, { production = false } = {}) {
  const kind = targetKind(url);
  if (!kind) throw new Error(`Refusing to connect to ${describeTarget(url)}: ${refusalReason(url)}`);
  if (kind === "production" && !production) throw new Error(`Refusing to connect to ${describeTarget(url)}: this script has no production path.`);
  if (kind !== "production" && production === "only") throw new Error(`Refusing to connect to ${describeTarget(url)}: this script runs on production only.`);
  const ca = process.env.DATABASE_CA_CERT;
  const ssl = kind === "local" ? false : ca ? { ca } : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Supabase's session pooler for Mumbai. GitHub's runners have no IPv6, and the direct address is IPv6 only. */
export const DEFAULT_POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";

/**
 * The production connection string, built from the password so the password never sits in a URL secret
 * (a password with `@` or `/` would otherwise break the URL). The ref is fixed in code, never read from input.
 * `poolerHost` is the host from the dashboard's "Session pooler" string when it differs (some projects get aws-1-...).
 */
export function productionUrl(password, poolerHost = DEFAULT_POOLER_HOST) {
  if (!password) throw new Error("The production database password is not set (PROD_SUPABASE_DB_PASSWORD).");
  const host = (poolerHost || DEFAULT_POOLER_HOST).trim();
  if (!/^aws-\d+-ap-south-1\.pooler\.supabase\.com$/.test(host)) throw new Error("PROD_SUPABASE_POOLER_HOST must look like aws-0-ap-south-1.pooler.supabase.com.");
  return `postgresql://postgres.${PRODUCTION_PROJECT}:${encodeURIComponent(password)}@${host}:5432/postgres`;
}

/** Where a connection string points, without the password: `host:port/database`. */
export function describeTarget(url) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
}
