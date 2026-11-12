import { defineConfig, devices } from "@playwright/test";
import { ADMIN_STATE, baseURL, checkDatabaseUrl, databaseUrl, port } from "./tests/e2e/support/env";

// End-to-end tests in a real browser against a production build (next build, then next start)
// on a migrated and seeded throwaway database. See README, Checks, for running them locally;
// CI runs them in the e2e job of .github/workflows/ci.yml.
//
// Each test makes its own act, venue, lead or wedding with a unique name, so the tests run in
// parallel and can be run again on the same database.

checkDatabaseUrl();
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  // One retry in CI only, so a flake shows up as "flaky" in the report instead of failing the
  // build; locally a failure is a failure.
  retries: isCI ? 1 : 0,
  // A production server on a small CI runner handles two browsers at a time comfortably.
  workers: isCI ? 2 : 3,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: isCI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    locale: "en-GB",
    timezoneId: "Europe/London",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Chromium is already installed in some environments (e.g. /opt/pw-browsers/chromium); point
    // PW_CHROMIUM at it if its version doesn't match this @playwright/test.
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined },
  },
  projects: [
    // Signs the seeded admin in once and saves the session for the staff tests.
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: ADMIN_STATE },
      dependencies: ["setup"],
    },
  ],
  // Starts the built app if nothing answers on the port yet; CI starts it itself first, so it's reused.
  webServer: {
    command: `npx next start -p ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: {
      DATABASE_URL: databaseUrl,
      APP_URL: baseURL,
      DISABLE_SCHEDULER: "1",
      CRON_SECRET: process.env.CRON_SECRET ?? "e2e-only-cron-secret",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
