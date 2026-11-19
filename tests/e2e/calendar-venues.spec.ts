import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, stamp } from "./support/data";
import { hydrated } from "./support/ui";

test("the calendar shows just the venues ticked in the filter, two or more at once", async ({ page }) => {
  const act = await createAct(stamp("E2E Venues Act"));
  const venues = [await createVenue(stamp("E2E Hall A")), await createVenue(stamp("E2E Hall B")), await createVenue(stamp("E2E Hall C"))];
  // One gig at each, on the 10th, 11th and 12th of next month.
  const now = new Date();
  const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const monthKey = month.toISOString().slice(0, 7);
  for (const [i, v] of venues.entries()) {
    const setStart = new Date(`${monthKey}-${String(10 + i).padStart(2, "0")}T20:00:00Z`);
    await createBooking({
      artistId: act.id,
      venueId: v.id,
      status: "CONFIRMED",
      arriveBy: new Date(setStart.getTime() - 3_600_000),
      setStart,
      setEnd: new Date(setStart.getTime() + 7_200_000),
    });
  }

  await page.goto(`/calendar?view=month&date=${monthKey}-10&artist=${act.id}`);
  // Shown on the page (the venue tick list inside the closed filter drop-down is not).
  const shown = (name: string) => page.getByText(name).locator("visible=true");
  for (const v of venues) await expect(shown(v.name).first()).toBeVisible();

  const filter = page.getByRole("button", { name: "Filter", exact: true });
  await hydrated(filter);
  await page.getByText("All venues").click();
  await page.getByRole("checkbox", { name: new RegExp(venues[0].name) }).check();
  await page.getByRole("checkbox", { name: new RegExp(venues[2].name) }).check();
  await page.getByRole("button", { name: "Show these venues" }).click();

  await expect(page).toHaveURL(new RegExp(`venue=${venues[0].id}`), { timeout: 20_000 });
  await expect(page.getByText("3 bookings").or(page.getByText("2 bookings at 2 venues"))).toContainText("2 bookings at 2 venues");
  await expect(shown(venues[0].name).first()).toBeVisible();
  await expect(shown(venues[2].name).first()).toBeVisible();
  await expect(shown(venues[1].name)).toHaveCount(0);
});

test("a new booking needs a venue", async ({ page }) => {
  await page.goto("/bookings/new");
  const create = page.getByRole("button", { name: "Create booking" });
  await hydrated(create);
  const form = page.locator("form").filter({ has: create });
  await expect(form.getByLabel("Venue", { exact: true })).toHaveAttribute("required", "");
});
