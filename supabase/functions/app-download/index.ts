import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { fetchLatestApk, type LatestApk } from "../_shared/latestApk.ts";
import { captureServerError } from "../_shared/monitoring.ts";

/**
 * The Download button on taskdrop.in/get (and so the QR code) opens this. It sends the phone to the
 * newest finished Android build from Expo, so nobody has to paste a new link after each build.
 *
 *   GET /functions/v1/app-download            ->  302 to the newest APK
 *   GET /functions/v1/app-download?json=1     ->  { version, builtAt } (nothing else)
 *
 * Public on purpose: a visitor has no account yet. It holds nothing secret and only ever redirects to
 * an address under https://expo.dev/artifacts/. The Expo token (EXPO_BUILDS_TOKEN, a read-only one) stays
 * here and is never sent to the browser. The answer is kept 60 seconds per instance, so a crowd tapping
 * Download costs Expo one question a minute. If Expo is down the last good answer is used for up to
 * 10 minutes; after that the visitor sees a plain "try again" message, never a raw error.
 */

const FRESH_MS = 60_000;
const STALE_MS = 10 * 60_000;

let kept: { at: number; apk: LatestApk } | null = null;

const text = (body: string, status: number) =>
  new Response(body, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });

async function newest(): Promise<LatestApk | null> {
  const now = Date.now();
  if (kept && now - kept.at < FRESH_MS) return kept.apk;
  const token = Deno.env.get("EXPO_BUILDS_TOKEN");
  if (!token) {
    console.error("app-download: EXPO_BUILDS_TOKEN is not set");
    return kept && now - kept.at < STALE_MS ? kept.apk : null;
  }
  try {
    const apk = await fetchLatestApk(token, fetch);
    if (apk) kept = { at: now, apk };
    return apk;
  } catch (e) {
    console.error("app-download: expo unavailable", (e as Error).message);
    const report = captureServerError(new Error("app-download: expo unavailable"), { fn: "app-download" });
    (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil?.(report);
    return kept && now - kept.at < STALE_MS ? kept.apk : null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "HEAD") return text("Unknown request", 405);
  const apk = await newest();
  if (!apk) return text("The app download is not available right now. Please try again in a few minutes.", 503);

  if (new URL(req.url).searchParams.get("json") === "1") {
    return new Response(JSON.stringify({ version: apk.version, builtAt: apk.builtAt }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
  return new Response(null, { status: 302, headers: { Location: apk.url, "Cache-Control": "no-store" } });
});
