import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests on the web build, against the cloud TEST project (fake data
 * only, the seed accounts from supabase/seed/test_data.sql). Run:
 *
 *   npm run web:export        # builds apps/mobile/dist with the test project's URL and key
 *   npm run test:e2e
 *
 * The server below serves that build. Settings come from the environment or
 * from apps/mobile/.env (see e2e/helpers.ts); nothing secret is needed, the
 * app's public key is the only key used, and sign-in is the dev code the
 * test phones are given. One worker: the tests share the seed accounts.
 */
const port = Number(process.env.E2E_PORT || 8099);

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.(spec|setup)\.ts/,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node e2e/serve-dist.mjs ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: true,
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "web-desktop",
      testMatch: /.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: "web-phone",
      testMatch: /ui\.spec\.ts/,
      dependencies: ["setup"],
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});
