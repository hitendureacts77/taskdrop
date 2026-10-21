import { test, expect, type Browser } from "@playwright/test";
import { ASHA, RAVI, accessToken, apiAs } from "./helpers";

/**
 * Rules the server must enforce even when the app is bypassed. These call the deployed `api` function
 * directly, so they pass only once the code under test has been deployed to the test project (the Vercel
 * build does that when a branch is merged into redesigned-2.0).
 */

const contexts: { close(): Promise<void> }[] = [];

async function caller(browser: Browser, state: string, request: import("@playwright/test").APIRequestContext) {
  const context = await browser.newContext({ storageState: state });
  contexts.push(context);
  const page = await context.newPage();
  await page.goto("/");
  return apiAs(request, await accessToken(page));
}

test.afterAll(async () => {
  await Promise.all(contexts.map((c) => c.close()));
});

test("a phone number sent straight to the API is refused in a post, a quote and the worker bio (Phase 3)", async ({ browser, playwright }) => {
  const request = await playwright.request.newContext();
  const asha = await caller(browser, ASHA.state, request);
  const ravi = await caller(browser, RAVI.state, request);

  const post = await asha("createTask", {
    pillar: "services",
    title: "[e2e] contact rule",
    description: "Call me on 98765 43210 to discuss.",
    benchmarkMinor: 10_000,
    timeLimitMinutes: 60,
  });
  expect(post.ok).toBe(false);
  if (!post.ok) expect(post.error.code).toBe("CONTACT_DETAILS");

  const bio = await ravi("updateProfileExtras", { workerBio: "WhatsApp me on 98765 43210" });
  expect(bio.ok).toBe(false);
  if (!bio.ok) expect(bio.error.code).toBe("CONTACT_DETAILS");
});

test("the uptime check answers without signing in (Phase 1)", async ({ playwright }) => {
  const request = await playwright.request.newContext();
  const { ANON_KEY, SUPABASE_URL } = await import("./helpers");
  const res = await request.post(`${SUPABASE_URL}/functions/v1/api`, {
    headers: { Authorization: `Bearer ${ANON_KEY}`, apikey: ANON_KEY },
    data: { op: "health" },
  });
  expect(res.status()).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, data: { status: "ok", database: true } });
});
