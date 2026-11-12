import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, someFutureDay, stamp } from "./support/data";
import { follow, hydrated, pickFromCombobox } from "./support/ui";

test("create a booking with New booking and find it in Venue bookings", async ({ page }) => {
  const act = await createAct(stamp("E2E Booking Act"));
  const venue = await createVenue(stamp("E2E Booking Hall"));
  const eventName = stamp("E2E Spring Social");

  await page.goto("/dashboard");
  await follow(page, page.getByRole("link", { name: "Venue bookings" }), page.getByRole("heading", { level: 1, name: "Venue bookings" }));
  // The full form, not the quick pop-up (that one is a button).
  await follow(page, page.getByRole("link", { name: "New booking", exact: true }), page.getByRole("heading", { level: 1, name: "New booking" }));

  const create = page.getByRole("button", { name: "Create booking" });
  await hydrated(create);
  // The quick New booking pop-up is in the page too, so look only inside this form.
  const form = page.locator("form").filter({ has: create });
  await pickFromCombobox(page, form.getByLabel("Act", { exact: true }), act.name);
  await pickFromCombobox(page, form.getByLabel("Venue", { exact: true }), venue.name);
  await form.getByLabel("Event name").fill(eventName);
  await form.getByLabel("Date", { exact: true }).fill(someFutureDay());
  await form.getByLabel("Arrive by").fill("18:00");
  await form.getByLabel("On stage").fill("20:30");
  await form.getByLabel("Off stage").fill("22:30");
  await create.click();

  // Saved: the booking's own page.
  await expect(page).toHaveURL(/\/bookings\/[^/]+$/, { timeout: 20_000 });
  const heading = page.getByRole("heading", { level: 1 });
  await expect(heading).toContainText(act.name);
  await expect(heading).toContainText("Pending");
  await expect(page.getByText(eventName)).toBeVisible();

  // And it's in Venue bookings. Opened from the dashboard: from a booking's own page the menu
  // link doesn't work at the moment (see the fixme test below).
  await page.goto("/dashboard");
  await follow(page, page.getByRole("link", { name: "Venue bookings" }), page.getByRole("heading", { level: 1, name: "Venue bookings" }));
  await page.getByRole("textbox", { name: "Search", exact: true }).fill(act.name);
  await page.getByRole("button", { name: "Filter" }).click();
  await expect(page).toHaveURL(/q=/);
  const row = page.getByRole("row").filter({ hasText: act.name });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(venue.name);
  await expect(row).toContainText("Pending");
});

// Known problem in the production build (Next 15.5): on a booking's page, the menu's Venue
// bookings link usually fetches the list but never shows it, so nothing happens (other menu links work,
// and a reload of the list is fine). Turn this back on once that's fixed.
test.fixme("the menu's Venue bookings link works from a booking's page", async ({ page }) => {
  const act = await createAct(stamp("E2E Menu Act"));
  const venue = await createVenue(stamp("E2E Menu Hall"));
  const day = Date.now() + 40 * 86_400_000;
  const booking = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "PENDING",
    arriveBy: new Date(day),
    setStart: new Date(day + 3_600_000),
    setEnd: new Date(day + 7_200_000),
  });
  await page.goto(`/bookings/${booking.id}`);
  const link = page.getByRole("link", { name: "Venue bookings" });
  await hydrated(link);
  await link.click();
  await expect(page.getByRole("heading", { level: 1, name: "Venue bookings" })).toBeVisible();
});
