import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2.116.0";

/**
 * Where an Edge Function gets its secrets.
 *
 * Two sources, in order:
 *
 *   1. An Edge Function secret (`supabase secrets set`). This is the normal
 *      path and always wins, so setting one later overrides everything here
 *      without a code change.
 *   2. Supabase Vault, read with the service role. Vault encrypts at rest and
 *      is reachable from SQL, which means the project can be configured
 *      without a CLI login — useful when whoever is setting it up has database
 *      access but not a Supabase personal access token.
 *
 * Nothing is compiled into the code any more (removed 2026-10-24, Phase 3,
 * "Keys, secrets and tokens"): a key checked into a file stays readable in git
 * history after the file is edited, so a missing secret now returns "" and the
 * caller says so. Never add a value here, test key or not.
 *
 * Values are cached for the life of the isolate: these change about once a
 * year, and a Vault round trip on every webhook would be silly.
 */

const cache = new Map<string, string>();
let vaultLoaded = false;

function admin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

/**
 * Pull every Vault secret once. One call rather than one per name, since a
 * function usually needs two or three of them together.
 */
async function loadVault(): Promise<void> {
  if (vaultLoaded) return;
  vaultLoaded = true;
  try {
    // public.app_secrets() rather than vault.decrypted_secrets: PostgREST only
    // serves the schemas it is configured to expose, and vault is not one of
    // them. The function is granted to service_role alone.
    const { data, error } = await admin().rpc("app_secrets");
    if (error) return;
    for (const [name, value] of Object.entries((data ?? {}) as Record<string, string>)) {
      // An env var set for this function is authoritative; never let Vault
      // shadow a value someone deliberately configured.
      if (value && !Deno.env.get(name)) cache.set(name, value);
    }
  } catch {
    // No Vault, no access, or the extension is absent — callers handle the
    // missing value and say so, which is better than throwing here.
  }
}

/** The value for `name`, or "" when it is configured nowhere. */
export async function secret(name: string): Promise<string> {
  const fromEnv = Deno.env.get(name);
  if (fromEnv) return fromEnv;
  await loadVault();
  const fromVault = cache.get(name);
  if (fromVault) return fromVault;
  return "";
}
