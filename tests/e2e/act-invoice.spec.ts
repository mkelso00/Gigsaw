import { expect, test } from "@playwright/test";
import { ADMIN_STATE } from "./support/env";
import { createAct, createActLogin, createBooking, createVenue, db, stamp } from "./support/data";
import { hydrated, signIn } from "./support/ui";

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("an act's invoice is made when they leave the venue, the agency pays it and the act sees it paid", async ({ page, browser }) => {
  const name = stamp("E2E Invoice Act");
  const act = await createAct(name);
  await db().artist.update({
    where: { id: act.id },
    data: {
      address: "1 Test Street\nLeeds LS1 1AA",
      bankAccountName: "E2E Act",
      bankSortCode: "11-22-33",
      bankAccountNumber: "44556677",
      // Complete details (the act app asks for them first otherwise), as an act who has signed up would have.
      niNumber: "AB123456C",
      detailsCompletedAt: new Date(),
    },
  });
  const venue = await createVenue(stamp("E2E Invoice Hall"));
  const login = await createActLogin(act.id, name);
  // On stage now, so check-in is open; they've already arrived.
  const now = Date.now();
  const booking = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "CONFIRMED",
    arriveBy: new Date(now - 2 * 3_600_000),
    setStart: new Date(now - 3_600_000),
    setEnd: new Date(now + 3_600_000),
    feeMinor: 90_000,
    artistFeeMinor: 61_500,
  });
  await db().checkIn.create({ data: { bookingId: booking.id, artistId: act.id, kind: "ARRIVED", source: "AGENT" } });

  await signIn(page, login.email, login.password);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await page.goto(`/app/gigs/${booking.id}`);
  const left = page.getByRole("button", { name: "I've left the venue" });
  await hydrated(left);
  await left.click();
  await expect(page.getByRole("status")).toContainText("Thanks, safe travels home.", { timeout: 20_000 });

  await page.goto("/app/invoices");
  await expect(page.getByRole("heading", { name: "Your invoices" })).toBeVisible();
  const row = page.getByRole("link", { name: /SB-\d+/ });
  await expect(row).toContainText("£615.00");
  await expect(row).toContainText("Not paid yet");
  // Only their fee: never the £900 the venue pays.
  await expect(page.getByText("£900")).toHaveCount(0);

  const invoice = await db().actInvoice.findUniqueOrThrow({ where: { liveBookingId: booking.id } });
  await page.goto(`/print/act-invoices/${invoice.id}`);
  await expect(page.getByText("Self-billing invoice", { exact: true })).toBeVisible();
  await expect(page.getByText("••••6677")).toBeVisible();
  await expect(page.getByText("44556677")).toHaveCount(0);
  await expect(page.getByText("£900")).toHaveCount(0);

  // The agency pays it from Pay acts.
  const staff = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const staffPage = await staff.newPage();
    await staffPage.goto(`/payments/acts?act=${act.id}`);
    const group = staffPage.getByRole("region", { name });
    await expect(group).toContainText(invoice.number);
    await expect(group).toContainText("44556677");
    const pay = group.getByRole("button", { name: "Mark paid" });
    await hydrated(pay);
    await pay.click();
    await expect(staffPage.getByRole("status")).toContainText("1 invoice marked paid (£615.00)", { timeout: 20_000 });
  } finally {
    await staff.close();
  }
  const paid = await db().payment.findMany({ where: { bookingId: booking.id, direction: "OUT" } });
  expect(paid.map((p) => p.amountMinor)).toEqual([61_500]);

  await page.goto("/app/invoices");
  await expect(page.getByRole("link", { name: /SB-\d+/ })).toContainText("Paid");
});
