import { expect, test } from "@playwright/test";
import { createAct, createBooking, createWedding, db, stamp } from "./support/data";

// The couple's page (/w/<token>, no login) shows the whole booking: every act and when, and what they've
// paid and have left to pay. Never what an act is paid.
test("the couple's page shows what's paid and what's left, never an act's fee", async ({ browser }) => {
  const wedding = await createWedding(stamp("E2E Couple Wedding"));
  const token = `e2e-planner-${Date.now()}-abcdefghijkl`;
  await db().event.update({ where: { id: wedding.id }, data: { plannerToken: token } });
  const act = await createAct(stamp("E2E Couple Singer"));
  const day = new Date(`${wedding.date}T18:00:00Z`).getTime();
  const b = await createBooking({
    artistId: act.id,
    venueId: (await db().venue.findFirstOrThrow({ where: { agencyId: wedding.agencyId } })).id,
    status: "CONFIRMED",
    arriveBy: new Date(day),
    setStart: new Date(day + 3_600_000),
    setEnd: new Date(day + 3 * 3_600_000),
    feeMinor: 100_000,
    artistFeeMinor: 60_000,
  });
  await db().booking.update({ where: { id: b.id }, data: { eventId: wedding.id, dealType: "BUY_SELL", vatPct: 0, bookingFeeMinor: 0 } });
  await db().payment.create({ data: { bookingId: b.id, direction: "IN", kind: "DEPOSIT", amountMinor: 25_000, paidAt: new Date() } });

  const couple = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const p = await couple.newPage();
    await p.goto(`/w/${token}`);
    const box = p.locator("section", { has: p.getByRole("heading", { name: "Your payments" }) });
    await expect(box).toBeVisible();
    await expect(box).toContainText("£1,000.00");
    await expect(box).toContainText("£250.00");
    await expect(box.getByText("Left to pay").locator("..")).toContainText("£750.00");
    await expect(p.getByText(act.name)).toBeVisible();
    await expect(p.getByText("£600.00")).toHaveCount(0);
  } finally {
    await couple.close();
  }
});
