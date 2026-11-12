import { expect, test } from "@playwright/test";
import { ADMIN } from "./support/env";
import { signIn } from "./support/ui";

// Starts signed out, unlike the other staff tests.
test.use({ storageState: { cookies: [], origins: [] } });

test("staff sign in and the dashboard loads", async ({ page }) => {
  // Signed out, the dashboard sends you to the login page.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();

  await signIn(page, ADMIN.email, ADMIN.password);

  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { level: 1, name: `Hello, ${ADMIN.firstName}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Coming up" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Venue bookings" })).toBeVisible();
});

test("a wrong password is refused", async ({ page }) => {
  // A made-up address, so the failed attempt never counts against the real admin login.
  await signIn(page, `nobody-${Date.now()}@e2e.gigsaw.invalid`, "not-the-password");
  await expect(page.getByRole("alert").filter({ hasText: "That email and password don't match." })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
