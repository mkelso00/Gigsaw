import { expect, test } from "@playwright/test";
import { createAct, createBooking, createWedding, db, stamp } from "./support/data";
import { hydrated } from "./support/ui";

// A wedding where the couple pays the deposit to the business and the band's fee straight to the band by
// bank transfer: their page shows the band's bank details; staff mark it paid on the wedding's page.
test("deposit to us, balance by bank transfer straight to the band", async ({ page, browser }) => {
  const wedding = await createWedding(stamp("E2E Direct Wedding"));
  const token = `e2e-direct-${Date.now()}-abcdefghijkl`;
  await db().event.update({ where: { id: wedding.id }, data: { plannerToken: token } });
  const act = await createAct(stamp("E2E Direct Band"));
  await db().artist.update({
    where: { id: act.id },
    data: { bankAccountName: "The Direct Band Ltd", bankSortCode: "12-34-56", bankAccountNumber: "87654321", detailsCompletedAt: new Date() },
  });
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
  await db().booking.update({ where: { id: b.id }, data: { eventId: wedding.id, dealType: "BUY_SELL", vatPct: 0, bookingFeeMinor: 0, depositMinor: 40_000 } });

  // Staff choose bank transfer straight to the band.
  await page.goto(`/events/${wedding.id}`);
  const section = page.locator("#pay-plan");
  await section.getByLabel(/bank transfer straight to the act/).check();
  const save = section.getByRole("button", { name: "Save" });
  await hydrated(save);
  await save.click();
  await expect(section.getByRole("button", { name: "Mark £600.00 paid" })).toBeVisible({ timeout: 15_000 });

  // The couple sees the deposit and the band's bank details.
  const couple = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const p = await couple.newPage();
    await p.goto(`/w/${token}`);
    const box = p.locator("section", { has: p.getByRole("heading", { name: "Your payments" }) });
    await expect(box).toContainText("£400.00");
    await expect(box).toContainText("The Direct Band Ltd");
    await expect(box).toContainText("12-34-56");
    await expect(box).toContainText("87654321");
    await expect(box).toContainText(b.reference);

    // Staff mark the band paid: the couple's page shows it.
    const mark = section.getByRole("button", { name: "Mark £600.00 paid" });
    await hydrated(mark);
    await mark.click();
    await expect(section.getByText("Paid", { exact: true })).toBeVisible({ timeout: 15_000 });
    await p.reload();
    await expect(box.getByText("87654321")).toHaveCount(0);
    await expect(box).toContainText("Paid ✓");
  } finally {
    await couple.close();
  }
  // Recorded as in from the couple and out to the band.
  const pays = await db().payment.findMany({ where: { bookingId: b.id }, orderBy: { direction: "asc" } });
  expect(pays.map((x) => [x.direction, x.amountMinor])).toEqual([
    ["IN", 60_000],
    ["OUT", 60_000],
  ]);
});
