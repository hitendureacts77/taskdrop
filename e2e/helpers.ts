import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** The seed accounts (supabase/seed/test_data.sql). Fake people, fake money. */
export const ASHA = { phone: "9990000001", label: "Asha (poster)", state: "e2e/.auth/asha.json" };
export const RAVI = { phone: "9990000002", label: "Ravi (worker)", state: "e2e/.auth/ravi.json" };
export const MEERA = { phone: "9990000003", label: "Meera (stranger)", state: "e2e/.auth/meera.json" };

function fromEnvFile(name: string): string {
  for (const f of ["apps/mobile/.env", "apps/mobile/.env.local"]) {
    const path = resolve(f);
    if (!existsSync(path)) continue;
    const line = readFileSync(path, "utf8").split(/\r?\n/).find((l) => l.startsWith(`${name}=`));
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  }
  return "";
}

const setting = (name: string) => process.env[name] || fromEnvFile(name);

/** The test project's URL and public (anon) key: the same two values the web build has. */
export const SUPABASE_URL = setting("EXPO_PUBLIC_SUPABASE_URL") || "https://wjxvingpfbfvkfqhrguj.supabase.co";
export const ANON_KEY = setting("EXPO_PUBLIC_SUPABASE_ANON_KEY");

if (!SUPABASE_URL.includes("wjxvingpfbfvkfqhrguj")) {
  // The tests create tasks and move fake money. Never let them run against anything else.
  throw new Error("The end-to-end tests only run against the cloud test project (wjxvingpfbfvkfqhrguj).");
}

/**
 * On the code screen of the test project: read the code the app shows in its "Test mode" box and type it
 * into the code field, the way a person would. The app no longer fills it in.
 */
export async function typeTestCode(page: Page, timeout = 15_000): Promise<void> {
  const code = (await page.getByTestId("dev-code").textContent({ timeout }))?.trim() ?? "";
  await page.getByLabel("Six-digit code").fill(code);
}

/**
 * Sign in through the real sign-in screen with a seed phone. The test project hands the code back
 * and the app shows it in a box to be typed (see typeTestCode). A code can be asked for once a minute
 * per number, so a refusal waits and tries again.
 */
export async function signInWithPhone(page: Page, phone: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    let cooldown = false;
    const watch = (r: { status(): number; url(): string }) => {
      if (r.url().includes("/functions/v1/phone-auth") && r.status() === 429) cooldown = true;
    };
    page.on("response", watch);
    await page.goto("/");
    await page.getByPlaceholder("98765 43210").fill(phone);
    await page.getByText("Text me a code").click();
    // A refusal (the one-a-minute cooldown) shows no code box; the wait below then ends and it tries again.
    await typeTestCode(page, 10_000).catch(() => null);
    const signedIn = page.getByText("Wallet").first();
    await Promise.race([signedIn.waitFor({ timeout: 30_000 }).catch(() => null), page.waitForTimeout(30_000)]);
    page.off("response", watch);
    if (await signedIn.isVisible().catch(() => false)) return;
    if (!cooldown || attempt === 3) break;
    await page.waitForTimeout(65_000);
  }
  throw new Error(`Could not sign in as ${phone}`);
}

/** The signed-in person's access token, from the app's own stored session. */
export async function accessToken(page: Page): Promise<string> {
  const raw = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    return key ? localStorage.getItem(key) : null;
  });
  const token = raw ? (JSON.parse(raw) as { access_token?: string }).access_token : undefined;
  if (!token) throw new Error("No stored session: sign in first");
  return token;
}

export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: { message: string; code: string } };

/** The ops that only read: asking again after a gateway timeout cannot do anything twice. */
const READS = /^(get|list|count|platform|search|can|my|is|age)/;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * One call to the app's single door, the `api` function, as a signed-in person, the way the web app makes it.
 *
 * A deploy takes the functions away for a few seconds and the gateway answers 502/503 (not our JSON). Such a
 * call never reached the function, so it is asked again, up to 4 times; a 504 is repeated for reads only.
 * If it still fails, the result is an ordinary `{ ok: false }` with the status, never a crash.
 */
export function apiAs(request: APIRequestContext, token: string) {
  return async function call<T = unknown>(op: string, args: Record<string, unknown> = {}): Promise<ApiResult<T>> {
    let last: ApiResult<T> = { ok: false, error: { code: "NO_REPLY", message: "no reply" } };
    for (let attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) await wait(attempt * 2000);
      const res = await request.post(`${SUPABASE_URL}/functions/v1/api`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: ANON_KEY,
          "x-taskdrop-platform": "web",
          "x-taskdrop-app-version": "1.0.0",
        },
        data: { op, args },
      });
      const body = (await res.json().catch(() => null)) as ApiResult<T> | null;
      if (body && typeof body === "object" && "ok" in body) return body;
      const status = res.status();
      last = { ok: false, error: { code: `HTTP_${status}`, message: `the gateway answered ${status}, not the app's JSON` } };
      const blip = status === 502 || status === 503 || (status === 504 && READS.test(op));
      if (!blip) break;
    }
    return last;
  };
}

/** Wait until the backend answers its uptime check (a deploy may be under way), so a run does not start into the gap. */
export async function waitForBackend(request: APIRequestContext, seconds = 90): Promise<void> {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const res = await request
      .post(`${SUPABASE_URL}/functions/v1/api`, {
        headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
        data: { op: "health" },
      })
      .catch(() => null);
    if (res?.status() === 200) return;
    if (Date.now() > until) throw new Error(`The backend did not answer its uptime check within ${seconds} s (status ${res?.status() ?? "none"}).`);
    await wait(3000);
  }
}

/** Unwrap a result that must have worked, with the server's own message if it did not. */
export function must<T>(r: ApiResult<T>, what: string): T {
  if (!r.ok) throw new Error(`${what}: ${r.error?.code ?? "?"} ${r.error?.message ?? "no message"}`);
  return r.data;
}

export async function expectSignedIn(page: Page) {
  await expect(page.getByText("Wallet").first()).toBeVisible();
}
