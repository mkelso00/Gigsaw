import { expect, test } from "@playwright/test";
import { createWedding, stamp } from "./support/data";
import { hydrated } from "./support/ui";

test("a checklist item on a wedding page can be ticked and unticked", async ({ page }) => {
  const wedding = await createWedding(stamp("E2E Wedding Ticks"));
  const task = "Deposit received";
  const tick = page.getByRole("button", { name: `Mark "${task}" as done` });
  const untick = page.getByRole("button", { name: `Mark "${task}" as not done` });

  await page.goto(`/events/${wedding.id}`);
  await expect(page.getByRole("heading", { level: 1, name: wedding.name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Checklist", exact: true })).toBeVisible();
  await expect(tick).toBeVisible();
  await expect(tick).toHaveText("");

  // Tick it: the box shows a tick. A save that Next doesn't redraw is reloaded by the app's
  // watchdog within a few seconds, so allow for that.
  await hydrated(tick);
  await tick.click();
  await expect(untick).toBeVisible({ timeout: 15_000 });
  await expect(untick).toHaveText("✓");

  // Untick it again.
  await hydrated(untick);
  await untick.click();
  await expect(tick).toBeVisible({ timeout: 15_000 });
  await expect(tick).toHaveText("");

  // And it stays that way when the page is opened again.
  await page.reload();
  await expect(tick).toBeVisible();
});
