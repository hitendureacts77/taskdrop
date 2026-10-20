import pg from "pg";

/**
 * Runs SQL against the database in DATABASE_URL with the `pg` driver, so the deploy and
 * seed scripts work on any machine (no psql needed). A file with several statements,
 * including its own begin/commit, goes through the simple query protocol as one call.
 */
export async function withDb(url, fn) {
  const local = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(url);
  const client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false } });
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
