import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, stamp } from "./support/data";
import { hydrated } from "./support/ui";

// The details card shown while the mouse is over a gig on the month view (src/components/gig-hover.tsx).
// It spills over the next day's square, and that day's gigs used to be drawn on top of it.

test("a gig's details card sits on top of the next day's gigs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1800 });
  const act = await createAct(stamp("E2E Hover Act"));
  const venue = await createVenue(stamp("E2E Hover Hall"));
  // A Tuesday in two months' time, and a busy Wednesday after it.
  const now = new Date();
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 8));
  while (day.getUTCDay() !== 2) day.setUTCDate(day.getUTCDate() + 1);
  const key = day.toISOString().slice(0, 10);
  const gigAt = (d: Date, hour: number) => {
    const setStart = new Date(d.getTime() + hour * 3_600_000);
    return createBooking({
      artistId: act.id,
      venueId: venue.id,
      status: "CONFIRMED",
      arriveBy: new Date(setStart.getTime() - 3_600_000),
      setStart,
      setEnd: new Date(setStart.getTime() + 3_600_000),
    });
  };
  const first = await gigAt(day, 12);
  const next = new Date(day.getTime() + 86_400_000);
  for (let h = 12; h < 20; h++) await gigAt(next, h);

  await page.goto(`/calendar?view=month&date=${key}&artist=${act.id}`);
  const gig = page.locator(`a[href="/bookings/${first.id}"]`);
  await hydrated(gig);
  await gig.scrollIntoViewIfNeeded();
  await gig.hover();
  const card = page.getByRole("tooltip");
  await expect(card).toBeVisible();
  // It opened below the gig, over the busy next day.
  expect((await card.boundingBox())!.y).toBeGreaterThan((await gig.boundingBox())!.y);

  // Nothing is drawn over any part of the card (it ignores the mouse, so let it be hit-tested for the check).
  const covered = await card.evaluate((el) => {
    (el as HTMLElement).style.pointerEvents = "auto";
    const r = el.getBoundingClientRect();
    const points = [
      [r.left + 10, r.top + 10],
      [r.right - 10, r.top + 10],
      [r.right - 10, r.bottom - 10],
      [r.left + 10, r.bottom - 10],
      [r.left + r.width / 2, r.top + r.height / 2],
    ];
    return points.filter(([x, y]) => !document.elementFromPoint(x, y)?.closest("[role=tooltip]")).length;
  });
  expect(covered).toBe(0);
});
