import { secret } from "./secrets.ts";

/**
 * The header that tells the database a request came through our own server.
 *
 * Once the lockdown (supabase/lockdown/gateway_only.sql) is applied, the
 * database refuses every data request that does not carry it -- so the public
 * anon key alone no longer reaches any table, the same way a Spring Boot
 * app's database is not on the internet. Service-role clients are exempt and
 * need nothing.
 *
 * The value lives in Vault (or an Edge Function secret) as API_GATEWAY_SECRET.
 * It must never reach the app.
 */
export const GATEWAY_HEADER = "x-taskdrop-gateway";

export async function gatewayHeaders(): Promise<Record<string, string>> {
  const value = await secret("API_GATEWAY_SECRET");
  return value ? { [GATEWAY_HEADER]: value } : {};
}
