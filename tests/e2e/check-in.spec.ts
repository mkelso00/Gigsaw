import { expect, test } from "@playwright/test";
import { ADMIN_STATE } from "./support/env";
import { createAct, createActLogin, createBooking, createVenue, stamp } from "./support/data";
import { expectAfterSave, hydrated, signIn } from "./support/ui";

// The venue, and a phone standing about 40 metres from it (well inside the 500 m geofence).
const VENUE = { latitude: 53.4794, longitude: -2.2453 };
const PHONE = { latitude: 53.4797, longitude: -2.2449, accuracy: 15 };

test.use({
  storageState: { cookies: [], origins: [] },
  geolocation: PHONE,
  permissions: ["geolocation"],
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
});

test("an act checks in from the act app with their location", async ({ page, browser }) => {
  const name = stamp("E2E Checkin Act");
  const act = await createAct(name);
  const venue = await createVenue(stamp("E2E Checkin Club"), VENUE);
  const login = await createActLogin(act.id, name);
  // Tonight's gig: call time in an hour, so check-in is open.
  const now = Date.now();
  const booking = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "CONFIRMED",
    arriveBy: new Date(now + 3_600_000),
    setStart: new Date(now + 3 * 3_600_000),
    setEnd: new Date(now + 5 * 3_600_000),
  });

  await signIn(page, login.email, login.password);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText(venue.name)).toBeVisible();

  const arrived = page.getByRole("button", { name: "I've arrived" });
  await hydrated(arrived);
  await arrived.click();
  await expect(page.getByRole("status")).toHaveText("You're checked in. Have a great show!", { timeout: 20_000 });
  // Once arrived, the next thing to press is leaving. The act app has no reload watchdog, so if
  // Next doesn't redraw after the check-in the page is opened again, as the act would.
  await expectAfterSave(page, page.getByRole("button", { name: "I've left the venue" }));

  // The agency sees the arrival, verified at the venue from the phone's location.
  const staff = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const staffPage = await staff.newPage();
    await staffPage.goto(`/bookings/${booking.id}`);
    await expect(staffPage.getByText("Verified at venue")).toBeVisible();
    await expect(staffPage.getByText(/m from the venue when they checked in/)).toBeVisible();
  } finally {
    await staff.close();
  }
});
