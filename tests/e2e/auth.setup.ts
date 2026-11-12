import { expect, test as setup } from "@playwright/test";
import { seededAgency } from "./support/data";
import { ADMIN, ADMIN_STATE } from "./support/env";
import { signIn } from "./support/ui";

// Sign the seeded admin in once and keep the session for every staff test.
setup("sign in as the seeded admin", async ({ page }) => {
  await seededAgency(); // a clear message if the database hasn't been seeded
  await signIn(page, ADMIN.email, ADMIN.password);
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 20_000 });
  await page.context().storageState({ path: ADMIN_STATE });
});
