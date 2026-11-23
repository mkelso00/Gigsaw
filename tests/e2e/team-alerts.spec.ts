import { expect, test } from "@playwright/test";
import { db, seededAgency } from "./support/data";
import { hydrated } from "./support/ui";

// Settings, Notifications, "Where team alerts go": the two shared inboxes and a choice for each alert save, show
// again after a reload, and fit a phone. Puts the seeded business's own choices back afterwards, so other tests
// running alongside see what they expect.
test("Where team alerts go: the inboxes and choices save, and the table fits a phone", async ({ page }) => {
  const { agencyId } = await seededAgency();
  const before = await db().settings.findUniqueOrThrow({ where: { agencyId }, select: { eventsEmail: true, gigsEmail: true, alertRouting: true } });
  const tag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const events = `events-${tag}@gigsaw.invalid`;
  try {
    await page.goto("/settings/notifications");
    await expect(page.getByRole("heading", { name: "Where team alerts go" })).toBeVisible();
    const inbox = page.locator('input[name="eventsEmail"]');
    await hydrated(inbox);
    await inbox.fill(events);
    const accepted = page.locator('select[name="route:ACCEPTED:EVENTS"]');
    const pick = (await accepted.inputValue()) === "INBOX" ? "BOTH" : "INBOX";
    await accepted.selectOption(pick);
    await page.locator('select[name="route:DECLINED:GIGS"]').selectOption("NOBODY");
    await expect(page.getByText("Unsaved changes")).toBeVisible();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText(/^Saved/).first()).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await expect(page.locator('input[name="eventsEmail"]')).toHaveValue(events);
    await expect(page.locator('select[name="route:ACCEPTED:EVENTS"]')).toHaveValue(pick);
    await expect(page.locator('select[name="route:DECLINED:GIGS"]')).toHaveValue("NOBODY");
    const saved = await db().settings.findUniqueOrThrow({ where: { agencyId } });
    expect(saved.eventsEmail).toBe(events);
    expect(saved.alertRouting).toMatchObject({ ACCEPTED: { EVENTS: pick }, DECLINED: { GIGS: "NOBODY" } });
    await expect(page.locator("#team-alerts").getByRole("link", { name: "profile", exact: true })).toHaveAttribute("href", "/profile#notifications");

    // On a phone the two columns stack, each drop-down with its own label, and nothing runs off the side.
    await page.setViewportSize({ width: 390, height: 844 });
    const section = page.locator("#team-alerts");
    const forEvents = section.getByRole("combobox", { name: "Weddings and events" }).first();
    const forGigs = section.getByRole("combobox", { name: "Venue gigs" }).first();
    await expect(section.locator("span.label", { hasText: /^Venue gigs$/ }).first()).toBeVisible();
    const [a, b] = [await forEvents.boundingBox(), await forGigs.boundingBox()];
    expect(b!.y).toBeGreaterThan(a!.y + a!.height - 1);
    const overflow = await section.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally {
    await db().settings.update({
      where: { agencyId },
      data: { eventsEmail: before.eventsEmail, gigsEmail: before.gigsEmail, alertRouting: before.alertRouting ?? {} },
    });
  }
});
