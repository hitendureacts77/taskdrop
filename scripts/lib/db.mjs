import pg from "pg";

/** The shared cloud test project (ground rule 8 in docs/UPGRADE_PLAN.md). */
export const TEST_PROJECT = "wjxvingpfbfvkfqhrguj";

/**
 * What a connection string points at: "local", "test" (the shared cloud test project), or null for
 * anything else, production included. Matches the exact Supabase hosts, not a name that merely
 * contains the project id: the direct host `db.<ref>.supabase.co`, or a pooler host with the
 * user `postgres.<ref>`.
 */
export function targetKind(url) {
  const u = new URL(url);
  const host = u.hostname;
  if (["localhost", "127.0.0.1", "[::1]", "::1"].includes(host)) return "local";
  if (host === `db.${TEST_PROJECT}.supabase.co`) return "test";
  if (host.endsWith(".pooler.supabase.com") && decodeURIComponent(u.username) === `postgres.${TEST_PROJECT}`) return "test";
  return null;
}

/**
 * Runs SQL against the database in DATABASE_URL with the `pg` driver, so the deploy and
 * seed scripts work on any machine (no psql needed). A file with several statements
 * goes through the simple query protocol as one call.
 *
 * Refuses any target but localhost or the test project, so these scripts can't be pointed at
 * production by a wrong DATABASE_URL. Phase 10 adds its own explicit path for production.
 *
 * Remote connections are encrypted. The server's certificate is checked only when
 * DATABASE_CA_CERT holds Supabase's root CA (PEM): that CA is not in the default trust store,
 * so verifying by default would reject every Supabase connection.
 */
export async function withDb(url, fn) {
  const kind = targetKind(url);
  if (!kind) throw new Error(`Refusing to connect to ${describeTarget(url)}: only localhost and the test project (${TEST_PROJECT}) are allowed.`);
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

/** Where a connection string points, without the password: `host:port/database`. */
export function describeTarget(url) {
  const u = new URL(url);
  return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
}
