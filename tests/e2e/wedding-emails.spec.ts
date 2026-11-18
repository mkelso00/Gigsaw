import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, createWedding, dayFromToday, db, seededAgency, stamp } from "./support/data";
import { hydrated } from "./support/ui";

// The wedding page's Automatic emails card: a wedding booked 2 months out has missed its 6-month emails,
// which staff can send now; the running order isn't in, so the page offers to send the acts the plan.

test("a late wedding's missed email can be sent now, and the page offers to send the acts the plan", async ({ page }) => {
  const name = stamp("E2E Late Wedding");
  const date = dayFromToday(60);
  const wedding = await createWedding(name, date);
  const { agencyId } = await seededAgency();
  const couple = await db().contact.create({
    data: { agencyId, type: "CLIENT", name: "Robin Late", email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.gigsaw.invalid` },
  });
  await db().event.update({ where: { id: wedding.id }, data: { customerId: couple.id } });
  const act = await createAct(stamp("E2E Late Band"));
  const venue = await createVenue(stamp("E2E Late Venue"));
  const setStart = new Date(`${date}T19:00:00Z`);
  const gig = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "CONFIRMED",
    arriveBy: new Date(setStart.getTime() - 3_600_000),
    setStart,
    setEnd: new Date(setStart.getTime() + 2 * 3_600_000),
    feeMinor: 150_000,
    artistFeeMinor: 90_000,
  });
  await db().booking.update({ where: { id: gig.id }, data: { eventId: wedding.id, promoterId: couple.id } });

  await page.goto(`/events/${wedding.id}`);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Automatic emails", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "3 months before: balance due" })).toBeVisible();

  // Every step has its own Send now; the 6-month ask for the running order has been missed.
  const step = page.locator('li[data-step="PLANNER_REQUEST"]');
  await expect(step).toContainText("missed: its window has passed");
  await expect(page.locator("li[data-step]").getByRole("button", { name: /^Send (now|again)$/ })).toHaveCount(10);

  // The running order isn't in at 3 months: a clear prompt to send the acts what there is.
  await expect(page.getByText("The running order isn't in yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send the plan to the acts" })).toBeVisible();

  const send = step.getByRole("button", { name: "Send now" });
  await hydrated(send);
  await send.click();
  await expect(step).toContainText("Couple · sent", { timeout: 15_000 });
  await expect(step.getByRole("button", { name: "Send again" })).toBeVisible();

  // And it stays sent.
  await page.reload();
  await expect(page.locator('li[data-step="PLANNER_REQUEST"]')).toContainText("Couple · sent");
  const claimed = await db().reminder.findMany({ where: { recipient: `event:${wedding.id}` } });
  expect(claimed.map((r) => r.kind)).toContain("EV_PLANNER_REQUEST");
});
