import { expect, test, type Page } from "@playwright/test";
import { createAct, createBooking, db, seededAgency, stamp } from "./support/data";
import { hydrated } from "./support/ui";

// The weekly pay run: check the week's act invoices, send them for the records, pay one payee, then all of them.
// Each test uses its own week, long ago, so the seed's and other tests' invoices are never in it.

/** A Monday ("YYYY-MM-DD") 2 to 15 years back, picked at random so parallel tests and runs don't share a week. */
function oldWeek() {
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }) + "T12:00:00Z");
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000);
  const weeksBack = 100 + Math.floor(Math.random() * 700);
  return new Date(monday.getTime() - weeksBack * 7 * 86_400_000).toISOString().slice(0, 10);
}

/** An act with its bank details in (so its invoices can be made), and finished gigs on these days of the week. */
async function actWithGigs(name: string, week: string, days: number[], feeMinor = 40_000) {
  const act = await createAct(name);
  await db().artist.update({
    where: { id: act.id },
    data: {
      address: "1 Test Street\nLeeds LS1 1AA",
      bankAccountName: name.toUpperCase().slice(0, 18),
      bankSortCode: "20-30-40",
      bankAccountNumber: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
      detailsCompletedAt: new Date(),
    },
  });
  const bookings = [];
  for (const d of days) {
    const setStart = new Date(`${week}T19:00:00Z`);
    setStart.setUTCDate(setStart.getUTCDate() + d);
    bookings.push(
      await createBooking({
        artistId: act.id,
        venueId: null,
        status: "CONFIRMED",
        arriveBy: new Date(setStart.getTime() - 3_600_000),
        setStart,
        setEnd: new Date(setStart.getTime() + 2 * 3_600_000),
        feeMinor: feeMinor * 2,
        artistFeeMinor: feeMinor,
      }),
    );
  }
  return { act, bookings };
}

/** Make the week's invoices from Check (they're too old for Gigsaw to have made them by itself). */
async function makeInvoices(page: Page, count: number) {
  const gaps = page.getByTestId("run-gaps");
  for (let left = count; left > 0; left--) {
    const make = gaps.getByRole("button", { name: "Make invoice" }).first();
    await hydrated(make);
    await make.click();
    // The row goes once the invoice is made (the button only says "Making…" meanwhile).
    await expect(gaps.locator("li")).toHaveCount(left - 1, { timeout: 15_000 });
  }
}

const row = (page: Page, name: string) => page.getByTestId("pay-row").filter({ has: page.getByTestId("pay-name").getByText(name, { exact: true }) });

test("check the week, send it for the records, pay one payee, then everyone", async ({ page }) => {
  const { agencyId } = await seededAgency();
  const week = oldWeek();
  const a = await actWithGigs(stamp("E2E Pay Alpha"), week, [1, 6]);
  const b = await actWithGigs(stamp("E2E Pay Bravo"), week, [3], 25_000);
  // Someone stood in on one of Alpha's gigs.
  const dep = await db().person.create({ data: { agencyId, firstName: "Dee", surname: stamp("Stand-in") } });
  await db().bookingLineup.create({ data: { bookingId: a.bookings[0].id, personId: dep.id, change: "IN" } });

  await page.goto(`/payments/run?week=${week}`);
  await expect(page.getByTestId("run-week")).toContainText("Mon ");
  await makeInvoices(page, 3);

  // (a) Check: grouped by payee, with the line-up change flagged.
  const check = page.getByTestId("run-check");
  await expect(check.getByTestId("check-payee").filter({ hasText: a.act.name })).toContainText("£800.00");
  await expect(check.getByTestId("check-payee").filter({ hasText: b.act.name })).toContainText("£250.00");
  await expect(page.getByTestId("run-warnings")).toContainText("1 gig with stand-ins or line-up changes");
  await expect(check.getByTestId("invoice-note").first()).toContainText("standing in");

  const send = page.getByRole("button", { name: "Send to Northern for our records" });
  await hydrated(send);
  await send.click();
  await expect(page.getByTestId("run-sent")).toContainText("by Alex Morgan", { timeout: 15_000 });
  const run = await db().payRun.findFirstOrThrow({ where: { agencyId, weekStart: week } });
  expect(run.sentInvoiceIds).toHaveLength(3);
  const msg = await db().message.findFirstOrThrow({ where: { agencyId, kind: "PAY_RUN" }, orderBy: { createdAt: "desc" } });
  expect(msg.body).toContain(a.act.name);
  expect(msg.body).toMatch(/Attached: act-invoices-w-c-.*\.csv .*\.pdf/);

  // (b) Pay: one row per payee, totalled.
  await expect(page.getByTestId("run-progress")).toHaveText("0 of 2 paid · £0.00 of £1,050.00");
  const alpha = row(page, a.act.name);
  await expect(alpha.getByTestId("pay-amount")).toContainText("£800.00");
  await expect(alpha).toContainText(/Northern SB-\d+/);
  const paid = alpha.getByRole("button", { name: "Paid", exact: true });
  await hydrated(paid);
  await paid.click();
  await expect(alpha.getByTestId("pay-paid")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("run-progress")).toHaveText("1 of 2 paid · £800.00 of £1,050.00");
  const payments = await db().payment.findMany({ where: { bookingId: { in: a.bookings.map((x) => x.id) }, direction: "OUT" } });
  expect(payments.map((p) => p.amountMinor).sort()).toEqual([40_000, 40_000]);

  // Undo, then tick it and mark the ticked paid.
  await alpha.getByRole("button", { name: "Undo" }).click();
  await expect(alpha.getByRole("button", { name: "Paid", exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("run-progress")).toHaveText("0 of 2 paid · £0.00 of £1,050.00");
  expect(await db().payment.count({ where: { bookingId: { in: a.bookings.map((x) => x.id) }, direction: "OUT" } })).toBe(0);
  const tick = alpha.getByRole("checkbox");
  await hydrated(tick);
  await tick.check();
  await page.getByRole("button", { name: "Mark ticked paid" }).click();
  await expect(alpha.getByTestId("pay-paid")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("run-progress")).toHaveText("1 of 2 paid · £800.00 of £1,050.00");

  // Then everyone left.

  const all = page.getByRole("button", { name: "Mark all paid" });
  await hydrated(all);
  await all.click();
  const yes = page.getByRole("button", { name: "Yes, mark all paid" });
  await expect(yes).toBeVisible({ timeout: 15_000 });
  await yes.click();
  // (c) Done.
  await expect(page.getByTestId("week-paid")).toContainText("Week paid", { timeout: 15_000 });
  await expect(page.getByTestId("run-progress")).toHaveText("2 of 2 paid · £1,050.00 of £1,050.00");
  expect(await db().actInvoice.count({ where: { agencyId, bookingId: { in: [...a.bookings, ...b.bookings].map((x) => x.id) }, status: "PAID" } })).toBe(3);
});

test("the pay run works on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const week = oldWeek();
  const a = await actWithGigs(stamp("E2E Phone Pay A"), week, [0]);
  const b = await actWithGigs(stamp("E2E Phone Pay B"), week, [6], 30_000);

  await page.goto(`/payments/run?week=${week}`);
  await makeInvoices(page, 2);
  const send = page.getByRole("button", { name: "Send to Northern for our records" });
  await hydrated(send);
  await send.click();
  await expect(page.getByTestId("run-sent")).toContainText("Sent", { timeout: 15_000 });

  // Nothing wider than the screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  // Every value to copy into the banking app has its own Copy button.
  const alpha = row(page, a.act.name);
  for (const what of ["amount", "account name", "sort code", "account number", "reference"]) {
    await expect(alpha.getByRole("button", { name: new RegExp(`^Copy ${what} for`) })).toBeVisible();
  }
  const paid = alpha.getByRole("button", { name: "Paid", exact: true });
  await hydrated(paid);
  await paid.click();
  await expect(alpha.getByTestId("pay-paid")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("run-progress")).toHaveText("1 of 2 paid · £400.00 of £700.00");

  // Then everyone left: the week is done.
  await expect(row(page, b.act.name).getByRole("button", { name: "Paid", exact: true })).toBeVisible();
  const all = page.getByRole("button", { name: "Mark all paid" });
  await hydrated(all);
  await all.click();
  await page.getByRole("button", { name: "Yes, mark all paid" }).click();
  await expect(page.getByTestId("week-paid")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("run-progress")).toHaveText("2 of 2 paid · £700.00 of £700.00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
