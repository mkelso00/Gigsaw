import { expect, test } from "@playwright/test";
import { hydrated } from "./support/ui";

// The calendar's title opens a small calendar to jump to any year, month or day.
test("jump to a date from the calendar's title", async ({ page }) => {
  await page.goto("/calendar?view=month&date=2026-11-17");
  const title = page.getByRole("button", { name: /November 2026: choose a date/ });
  await hydrated(title);
  await title.click();
  const picker = page.getByRole("dialog", { name: "Choose a date" });
  await picker.getByRole("button", { name: "Next year" }).click();
  await picker.getByRole("button", { name: "Jun", exact: true }).click();
  await picker.getByRole("link", { name: "14", exact: true }).click();
  await expect(page).toHaveURL(/date=2027-06-14/);
  await expect(page.getByRole("button", { name: /June 2027: choose a date/ })).toBeVisible();
});
