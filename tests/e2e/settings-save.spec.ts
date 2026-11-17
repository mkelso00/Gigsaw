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

test("Settings → Email design: a preset and a logo show in the preview and save", async ({ page }) => {
  await page.goto("/settings/email-design");
  const preview = page.frameLocator('iframe[title="Email preview"]');
  await expect(preview.getByRole("heading", { name: "Thanks for your enquiry" })).toBeVisible();
  // Whichever of two presets isn't already chosen, so the test can run again on the same database.
  const now = await page.locator('input[name="header"]').inputValue();
  const [name, header] = now === "#14213d" ? ["Forest", "#1f3b2d"] : ["Navy", "#14213d"];
  const preset = page.getByRole("button", { name });
  await hydrated(preset);
  await preset.click();
  await expect(page.locator('input[name="header"]')).toHaveValue(header);
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  // A 1×1 PNG.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[name="logo"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await expect(preview.locator("img").first()).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/^Saved/).first()).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.locator('input[name="header"]')).toHaveValue(header);
  const src = await page.getByRole("img", { name: "Your logo" }).getAttribute("src");
  const logo = await page.request.get(src!);
  expect(logo.status()).toBe(200);
  expect(logo.headers()["content-type"]).toBe("image/png");
});
