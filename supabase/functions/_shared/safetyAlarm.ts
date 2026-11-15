/**
 * The production safety alarm (plan task 5.9, holes H1 and H15).
 *
 * A brand-new database built from the code starts with the test sign-in on (migration 053), and a function
 * secret meant for staging can be pasted into the wrong project by mistake. This decides, from what the
 * production project holds, whether any test shortcut is switched on. The `safety-alarm` Inngest job reads
 * the values every hour and, when this returns anything, sends a `fatal` event to Sentry, whose alert rule
 * emails the owner at once.
 *
 * It only runs its checks on production: a project that is not the staging project or a developer's machine
 * (the same host rule as devMode.ts). Staging is meant to have these shortcuts on, so it is never judged.
 *
 * Pure on purpose (no Deno imports), so it can be exercised from Node. Findings name a setting and why it is
 * wrong, never a value.
 */
import { devModeAllowed } from "./devMode.ts";
import { keyKind } from "./keyMode.ts";

export type SafetyInputs = {
  /** SUPABASE_URL of the project the job runs in. */
  supabaseUrl: string | null | undefined;
  /** app_controls 'all' row `environment`, as get_app_controls() returns it. */
  environment: unknown;
  /** public.settings `dev_otp_for_all` (true = any phone number signs in with an on-screen code). */
  devOtpForAll: unknown;
  /** The function secrets that must never be set in production, by name. Only "is it set" is used. */
  env: Record<string, string | undefined>;
  /** Razorpay key ids the money functions would use (RAZORPAY_KEY_ID, RAZORPAYX_KEY_ID), by name. */
  razorpayKeyIds: Record<string, string | null | undefined>;
};

/** Function secrets that are test shortcuts. Any of them set on production is an alarm. */
export const FORBIDDEN_IN_PRODUCTION = [
  "ALLOW_ANY_OTP",
  "TEST_PHONES",
  "APP_CHECK_DEBUG_TOKEN",
  "EXPO_PUBLIC_APP_CHECK_DEBUG_TOKEN",
  "INNGEST_DEV",
] as const;

export type SafetyFinding = { code: string; what: string };

/** True when the project is production: neither staging nor localhost (an unreadable address counts as production). */
export function isProductionProject(supabaseUrl: string | null | undefined): boolean {
  return !devModeAllowed(supabaseUrl);
}

/** Every test shortcut found switched on in production; empty means all clear (and always empty off production). */
export function safetyFindings(input: SafetyInputs): SafetyFinding[] {
  if (!isProductionProject(input.supabaseUrl)) return [];
  const found: SafetyFinding[] = [];

  if (input.environment !== "production") {
    found.push({ code: "ENVIRONMENT_NOT_PRODUCTION", what: "The environment setting is not 'production', so test payment keys would be accepted." });
  }
  // Anything but an explicit false is treated as on: a missing or odd value must not read as safe.
  if (input.devOtpForAll !== false && input.devOtpForAll !== "false") {
    found.push({ code: "DEV_OTP_FOR_ALL_ON", what: "dev_otp_for_all is not off: any phone number could sign in with a code shown on screen." });
  }
  for (const name of FORBIDDEN_IN_PRODUCTION) {
    if ((input.env[name] ?? "").trim() !== "") {
      found.push({ code: `${name}_SET`, what: `The function secret ${name} is set. It is a test shortcut and must not exist in production.` });
    }
  }
  for (const [name, id] of Object.entries(input.razorpayKeyIds)) {
    if (keyKind(id) === "test") {
      found.push({ code: `${name}_IS_TEST_KEY`, what: `${name} is a Razorpay test key (rzp_test_...). Production must hold only live keys.` });
    }
  }
  return found;
}

/** One line for Sentry and the logs. Holds codes only, never a value. */
export function alarmMessage(findings: SafetyFinding[]): string {
  return `safety alarm: production has a test shortcut on (${findings.map((f) => f.code).join(", ")})`;
}
