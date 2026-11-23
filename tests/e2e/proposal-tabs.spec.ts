import { expect, test } from "@playwright/test";

test("Proposals has a tab for each stage, with counts", async ({ page }) => {
  await page.goto("/enquiries?view=quotes");
  const tabs = page.getByRole("navigation", { name: "Proposals by stage" });
  for (const name of ["All", "Drafts, not sent", "Sent, waiting for an answer", "Accepted", "Declined", "Expired: no reply", "Withdrawn"]) {
    await expect(tabs.getByRole("link", { name: new RegExp(`^${name} \\d+$`) })).toBeVisible();
  }
  await tabs.getByRole("link", { name: /^Drafts, not sent \d+$/ }).click();
  await expect(page).toHaveURL(/status=DRAFT/);
  await expect(tabs.getByRole("link", { name: /^Drafts, not sent/ })).toHaveAttribute("aria-current", "page");
});
