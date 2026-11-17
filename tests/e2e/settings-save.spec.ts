import { expect, test } from "@playwright/test";
import { hydrated } from "./support/ui";

// A settings page keeps showing what was just saved. Drop-downs used to jump back to their old choice
// straight after Save (the choice was saved, but it looked as if it hadn't been).
test("a drop-down on a settings page keeps the saved choice after Save, and Discard goes back to it", async ({ page }) => {
  await page.goto("/settings/enquiries");
  const tell = page.locator('select[name="notify"]');
  const start = await tell.inputValue();
  const pick = start === "ADMINS" ? "TEAM" : "ADMINS";
  await hydrated(tell);
  await tell.selectOption(pick);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^Saved/).first()).toBeVisible({ timeout: 15_000 });
  await expect(tell).toHaveValue(pick);
  // Change it again and discard: back to the saved choice, not the one the page first loaded with.
  await tell.selectOption("BUSINESS");
  await page.getByRole("button", { name: "Discard" }).click();
  await expect(tell).toHaveValue(pick);
  await page.reload();
  await expect(page.locator('select[name="notify"]')).toHaveValue(pick);
});
