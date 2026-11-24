import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, db, stamp } from "./support/data";
import { follow, hydrated } from "./support/ui";

/** "HH:MM" in the venue's time zone. */
const clock = (d: Date) => d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });

/** A Wednesday some weeks ahead (UTC noon), so the gigs below fall on Wednesdays and a Thursday. */
function aWednesday() {
  const d = new Date(Date.now() + (70 + Math.floor(Math.random() * 200)) * 86_400_000);
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((3 - d.getUTCDay() + 7) % 7));
  return d.getTime();
}

test("edit one booking and copy the new start time and travel to the venue's other Wednesdays", async ({ page }) => {
  const act = await createAct(stamp("E2E Residency Act"));
  const venue = await createVenue(stamp("E2E Swan"));
  const wed = aWednesday();
  const week = 7 * 86_400_000;
  // Gigs at 19:00 to 22:00 UTC: the same clock time whichever side of a clock change, give or take the hour.
  const at = (day: number) => ({
    artistId: act.id,
    venueId: venue.id,
    status: "CONFIRMED",
    arriveBy: new Date(day + 6 * 3_600_000),
    setStart: new Date(day + 7 * 3_600_000),
    setEnd: new Date(day + 10 * 3_600_000),
  });
  const source = await createBooking(at(wed));
  const wed2 = await createBooking(at(wed + week));
  const wed3 = await createBooking(at(wed + 2 * week));
  const thu = await createBooking(at(wed + week + 86_400_000));
  const cancelled = await createBooking({ ...at(wed + 3 * week), status: "CANCELLED" });

  // The booking's page points to both ways of changing several bookings.
  await page.goto(`/bookings/${source.id}`);
  await expect(page.getByRole("link", { name: "change several bookings at once" })).toHaveAttribute("href", `/bookings?venue=${venue.id}`);
  await follow(page, page.getByRole("link", { name: "Edit", exact: true }).first(), page.getByRole("heading", { level: 1, name: `Edit ${source.reference}` }));

  const save = page.getByRole("button", { name: "Save changes" });
  await hydrated(save);
  const panel = page.getByRole("region", { name: `Also change other bookings at ${venue.name}` });
  await expect(panel.getByRole("radio", { name: /Only this booking/ })).toBeChecked();
  await expect(panel.getByText(`All upcoming bookings at ${venue.name}`).locator("..")).toContainText("3 more bookings");
  await expect(panel.getByText("All upcoming Wednesdays, any time").locator("..")).toContainText("2 more bookings");

  // The quick New booking pop-up is in the page too, so look only inside this form.
  const form = page.locator("form").filter({ has: save });
  await form.getByLabel("Start", { exact: true }).fill("21:15");
  await form.getByLabel("Travel", { exact: true }).fill("Park in the yard behind the pub");
  await panel.getByRole("radio", { name: /All upcoming Wednesdays, any time/ }).check();
  await save.click();

  // Asked first, with the count and what changes.
  const ask = page.getByRole("alert").filter({ hasText: "Change start time and travel" });
  await expect(ask).toContainText(`Change start time and travel on 2 other upcoming Wednesdays at ${venue.name}?`);
  await ask.getByRole("button", { name: "Change 3 bookings" }).click();
  await expect(page).toHaveURL(new RegExp(`/bookings/${source.id}$`), { timeout: 20_000 });
  await expect(page.getByText("changed other bookings too")).toBeVisible();

  const rows = await db().booking.findMany({ where: { id: { in: [source.id, wed2.id, wed3.id, thu.id, cancelled.id] } } });
  const by = new Map(rows.map((r) => [r.id, r]));
  for (const id of [source.id, wed2.id, wed3.id]) {
    expect(clock(by.get(id)!.setStart)).toBe("21:15");
    expect(by.get(id)!.travel).toBe("Park in the yard behind the pub");
  }
  // The Thursday and the cancelled gig are left alone.
  for (const id of [thu.id, cancelled.id]) {
    expect(by.get(id)!.travel).toBe("");
    expect(by.get(id)!.setStart.getTime()).toBe(id === thu.id ? thu.setStart.getTime() : cancelled.setStart.getTime());
  }

  // "Change several bookings at once" opens the venue's bookings, ready to tick.
  await page.goto(`/bookings?venue=${venue.id}`);
  await expect(page.getByText(`Bookings at ${venue.name}`)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: act.name })).toHaveCount(5);
});
