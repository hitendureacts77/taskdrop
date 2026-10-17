import { MAINTENANCE_FALLBACK, UPDATE_REQUIRED_MESSAGE, parseControls, readClient } from "./controls.ts";

/**
 * The admin panel's sign-in switches (migration 092), for the auth functions
 * (phone-auth, password-auth) that sit outside the api function. Google
 * sign-in goes straight through Supabase and can only be hidden in the app.
 *
 * Returns the message to refuse with, or null to carry on. If the switches
 * cannot be read the person is let through: an outage of the switches must not
 * lock everyone out.
 */
export type SignInKind = "phone" | "password" | "signup";

export async function signInRefusal(
  db: { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> },
  headers: { get(name: string): string | null },
  kind: SignInKind,
): Promise<string | null> {
  try {
    const client = readClient(headers);
    const { data, error } = await db.rpc("get_app_controls", { p_platform: client.platform, p_version: client.appVersion });
    const c = error ? null : parseControls(data);
    if (!c) return null;
    if (c.maintenance) return c.maintenance_message?.trim() || MAINTENANCE_FALLBACK;
    if (c.update_required) return UPDATE_REQUIRED_MESSAGE;
    if (kind === "signup" && !c.signups_open) return "New sign-ups are paused for now. Please try again later.";
    if (kind === "phone" && !c.signin_phone) return "Signing in with a mobile number is switched off for now. Please try another way.";
    if (kind === "password" && !c.signin_password) return "Signing in with a password is switched off for now. Please try another way.";
    return null;
  } catch (e) {
    console.error("sign-in switches unavailable", e);
    return null;
  }
}
