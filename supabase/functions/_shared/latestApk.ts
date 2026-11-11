/**
 * Finds the newest Android build for the website's download page (design D17).
 *
 * Expo builds the `beta` profile by itself on every merge into redesigned-2.0. Each finished build has its
 * own APK address that Expo deletes after 14 days, so the website must not remember one: it asks Expo for
 * the newest finished build every time someone taps Download (`supabase/functions/app-download`).
 *
 * Plain TypeScript with no Deno imports so the tests run it with Node.
 */

/** The Expo app id of `@hitendureacts/taskdrop` (an id, not a secret: it is in every build's address). */
export const EXPO_APP_ID = "08aa002b-4eea-4952-a62a-ec9245e77953";
export const EXPO_GRAPHQL_URL = "https://api.expo.dev/graphql";
/** The build profile in eas.json that the phones use (package com.taskdrop.app, update channel beta). */
export const BUILD_PROFILE = "beta";

export const LATEST_APK_QUERY = `query LatestApk($appId: String!, $filter: BuildFilter) {
  app { byId(appId: $appId) {
    builds(offset: 0, limit: 5, filter: $filter) {
      id status appVersion createdAt expirationDate artifacts { applicationArchiveUrl buildUrl }
    }
  } }
}`;

export type ExpoBuild = {
  id?: string;
  status?: string;
  appVersion?: string | null;
  createdAt?: string | null;
  expirationDate?: string | null;
  artifacts?: { applicationArchiveUrl?: string | null; buildUrl?: string | null } | null;
};

export type LatestApk = { url: string; version: string | null; builtAt: string | null };

/** Only addresses Expo serves artifacts from are ever redirected to. */
export function isExpoArtifactUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === "expo.dev" && u.pathname.startsWith("/artifacts/");
  } catch {
    return false;
  }
}

/**
 * The newest finished build whose file is still there. Expo lists newest first, but the order is not
 * relied on: the newest `createdAt` wins. A build past its expiry date is skipped.
 */
export function pickLatestApk(builds: readonly ExpoBuild[] | null | undefined, now = Date.now()): LatestApk | null {
  const usable = (builds ?? [])
    .filter((b) => b && b.status === "FINISHED")
    .filter((b) => isExpoArtifactUrl(b.artifacts?.applicationArchiveUrl ?? b.artifacts?.buildUrl))
    .filter((b) => {
      const gone = b.expirationDate ? Date.parse(b.expirationDate) : NaN;
      return !(Number.isFinite(gone) && gone <= now);
    })
    .sort((a, b) => (Date.parse(b.createdAt ?? "") || 0) - (Date.parse(a.createdAt ?? "") || 0));
  const best = usable[0];
  if (!best) return null;
  return {
    url: (best.artifacts?.applicationArchiveUrl ?? best.artifacts?.buildUrl) as string,
    version: best.appVersion ?? null,
    builtAt: best.createdAt ?? null,
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<
  { ok: boolean; status: number; json(): Promise<unknown> }
>;

/** Asks Expo. Returns null when there is no usable build; throws when Expo cannot be reached or refuses. */
export async function fetchLatestApk(token: string, fetchFn: FetchLike, now = Date.now()): Promise<LatestApk | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetchFn(EXPO_GRAPHQL_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: LATEST_APK_QUERY,
        variables: { appId: EXPO_APP_ID, filter: { platform: "ANDROID", status: "FINISHED", buildProfile: BUILD_PROFILE } },
      }),
      signal: ctl.signal,
    });
    if (!res.ok) throw new Error(`expo answered ${res.status}`);
    const body = (await res.json()) as { data?: { app?: { byId?: { builds?: ExpoBuild[] } } }; errors?: unknown[] };
    if (body.errors?.length) throw new Error("expo refused the question");
    return pickLatestApk(body.data?.app?.byId?.builds, now);
  } finally {
    clearTimeout(timer);
  }
}
