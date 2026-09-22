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
 *   3. COMPILED_IN below — test keys checked into this file, so a fresh
 *      checkout can take a payment without any setup. Never live keys.
 *
 * Values are cached for the life of the isolate: these change about once a
 * year, and a Vault round trip on every webhook would be silly.
 */

/**
 * Keys compiled into the function.
 *
 * Third and last in the order below, so an Edge Function secret or a Vault
 * entry still wins and these are only reached when neither is set. That
 * matters: rotating a key should not need a code change.
 *
 * These are RAZORPAY **TEST** keys, and they live in *server* code. Supabase
 * Edge Functions run on Supabase, not on anyone's phone, so nothing here ships
 * in the app bundle and no user can read it out of an APK.
 *
 * Two rules for whoever comes next:
 *
 *   1. A LIVE key secret must never be added here. It authorises refunds and
 *      reads every payment on the account, and a checked-in secret lives in
 *      git history forever, long after the file is edited. Live keys go in
 *      Vault or an Edge Function secret — both already take priority.
 *   2. Nothing from this map may be imported by apps/mobile. The bundle is
 *      readable by anyone who downloads the app.
 */
const COMPILED_IN: Record<string, string> = {
  RAZORPAY_KEY_ID: "rzp_test_TbzhiEFzl8BDjA",
  RAZORPAY_KEY_SECRET: "3pc7JdRcskNwJ9y3orIhRah3",
};

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
  // Last resort, so a fresh checkout works without any setup at all.
  return COMPILED_IN[name] ?? "";
}
