/** How recent a sign-in must be to set or change the password (S6-17). */
export const PASSWORD_CHANGE_WINDOW_MS = 15 * 60_000;

/** True when the last sign-in is recent enough to set a password. A missing or unreadable time is refused. */
export function passwordChangeAllowed(lastSignInAt: string | null | undefined, now = Date.now()): boolean {
  const at = lastSignInAt ? Date.parse(lastSignInAt) : NaN;
  return Number.isFinite(at) && now - at <= PASSWORD_CHANGE_WINDOW_MS && at <= now + 60_000;
}
