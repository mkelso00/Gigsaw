import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, stamp } from "./support/data";
import { expectAfterSave, hydrated, linkFromCopyField } from "./support/ui";

test("an act accepts an offer from its link and the booking is confirmed", async ({ page, browser }) => {
  const act = await createAct(stamp("E2E Offer Act"));
  const venue = await createVenue(stamp("E2E Offer Rooms"));
  const day = Date.now() + 45 * 86_400_000;
  const booking = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "PENDING",
    arriveBy: new Date(day),
    setStart: new Date(day + 2 * 3_600_000),
    setEnd: new Date(day + 4 * 3_600_000),
    feeMinor: 80_000,
    artistFeeMinor: 60_000,
  });

  // Staff move the booking to Awaiting confirmation, which makes the offer and its link.
  await page.goto(`/bookings/${booking.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Pending");
  const update = page.getByRole("button", { name: "Update" });
  await hydrated(update);
  await page.getByRole("combobox").filter({ has: page.getByRole("option", { name: "Awaiting confirmation" }) }).selectOption({ label: "Awaiting confirmation" });
  await update.click();
  await expect(page.getByText("Waiting for the act to answer")).toBeVisible({ timeout: 15_000 });
  const offerLink = await linkFromCopyField(page, "/o/");

  // The act opens the link on their phone: no login.
  const actContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const actPage = await actContext.newPage();
    await actPage.goto(offerLink);
    await expect(actPage.getByRole("heading", { level: 1, name: "Booking offer" })).toBeVisible();
    await expect(actPage.getByText(`For ${act.name}`)).toBeVisible();
    await expect(actPage.getByText(venue.name)).toBeVisible();
    await expect(actPage.getByText("£600.00")).toBeVisible(); // the act's own fee, never the venue's price
    const accept = actPage.getByRole("button", { name: "Accept", exact: true });
    await hydrated(accept);
    await accept.click();
    // The page is drawn again from the server with the offer answered (the short "Accepted" note
    // from the button may only flash first).
    const done = actPage.getByRole("heading", { level: 1, name: "You've accepted this booking" });
    await expectAfterSave(actPage, done, 15_000);

    // Opened again, the link still says it's done and can't be answered twice.
    await actPage.reload();
    await expect(done).toBeVisible();
    await expect(actPage.getByRole("button", { name: "Accept", exact: true })).toHaveCount(0);
  } finally {
    await actContext.close();
  }

  // Back with the agency: confirmed.
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Confirmed");
  await expect(page.getByText("Accepted by the act")).toBeVisible();
});
