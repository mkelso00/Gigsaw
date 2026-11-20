import { expect, test, type Page } from "@playwright/test";
import { db, stamp } from "./support/data";
import { hydrated, signIn } from "./support/ui";

// Signing off the week, for a business whose act invoices are made then: the seeded Harbour Music. Tick off last
// week's gigs (leaving out a no-show with a reason), sign off, send for the records, pay one payee, then everyone.
// Each test uses its own week long ago, so nothing else is in it.

test.use({ storageState: { cookies: [], origins: [] } });

const HARBOUR = { email: "harbour@gigsaw.test", password: "gigsaw123", name: "Jo Rivers" };

function oldWeek() {
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" }) + "T12:00:00Z");
  const monday = new Date(today.getTime() - ((today.getUTCDay() + 6) % 7) * 86_400_000);
  return new Date(monday.getTime() - (100 + Math.floor(Math.random() * 700)) * 7 * 86_400_000).toISOString().slice(0, 10);
}

async function harbour() {
  const admin = await db().user.findUniqueOrThrow({ where: { email: HARBOUR.email } });
  return admin.agencyId!;
}

/** A Harbour act with its pay details in, and confirmed gigs on these days of the week. */
async function actWithGigs(name: string, week: string, days: number[], feeMinor = 40_000) {
  const agencyId = await harbour();
  const act = await db().artist.create({
    data: {
      agencyId,
      name,
      address: "1 Quay Street\nBristol",
      bankAccountName: name.toUpperCase().slice(0, 18),
      bankSortCode: "30-40-50",
      bankAccountNumber: String(10_000_000 + Math.floor(Math.random() * 89_999_999)),
      detailsCompletedAt: new Date(),
    },
  });
  const bookings = [];
  for (const d of days) {
    const setStart = new Date(`${week}T19:00:00Z`);
    setStart.setUTCDate(setStart.getUTCDate() + d);
    bookings.push(
      await db().booking.create({
        data: {
          agencyId,
          reference: stamp("HB").replace(/\s+/g, "-").toUpperCase(),
          artistId: act.id,
          status: "CONFIRMED",
          arriveBy: new Date(setStart.getTime() - 3_600_000),
          setStart,
          setEnd: new Date(setStart.getTime() + 2 * 3_600_000),
          feeMinor: feeMinor * 2,
          artistFeeMinor: feeMinor,
        },
      }),
    );
  }
  return { act, bookings };
}

const row = (page: Page, name: string) => page.getByTestId("pay-row").filter({ has: page.getByTestId("pay-name").getByText(name, { exact: true }) });

test("sign off the week, leaving out a no-show, then send and pay", async ({ page }) => {
  const agencyId = await harbour();
  const week = oldWeek();
  const a = await actWithGigs(stamp("E2E Signoff Alpha"), week, [1, 5]);
  const b = await actWithGigs(stamp("E2E Signoff Bravo"), week, [3], 25_000);
  const c = await actWithGigs(stamp("E2E Signoff NoShow"), week, [4]);

  await signIn(page, HARBOUR.email, HARBOUR.password);
  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });
  await page.goto(`/payments/run?week=${week}`);
  await expect(page.getByRole("heading", { name: "Sign off the week" })).toBeVisible();
  await expect(page.getByTestId("signoff-gig")).toHaveCount(4);

  // Nothing is invoiced until the week is signed off.
  expect(await db().actInvoice.count({ where: { agencyId, bookingId: { in: [...a.bookings, ...b.bookings, ...c.bookings].map((x) => x.id) } } })).toBe(0);

  // The no-show is unticked, with a reason.
  const noShowLabel = `${c.act.name}, ${c.bookings[0].reference}`;
  const tick = page.getByRole("checkbox", { name: `Played: ${noShowLabel}` });
  await hydrated(tick);
  await expect(tick).toBeChecked();
  await tick.uncheck();
  await page.getByRole("textbox", { name: `Why ${noShowLabel} is left out` }).fill("Didn't turn up");
  await page.getByRole("button", { name: "Sign off the week" }).click();
  await expect(page.getByTestId("run-signed-off")).toContainText(`by ${HARBOUR.name}`, { timeout: 20_000 });
  await expect(page.getByTestId("run-signed-off")).toContainText("3 played, 1 left out");
  await expect(page.locator(`[data-gig="${c.bookings[0].id}"]`)).toContainText("Left out by Jo Rivers: Didn't turn up");

  expect(await db().actInvoice.count({ where: { bookingId: c.bookings[0].id } })).toBe(0);
  expect(await db().actInvoice.count({ where: { bookingId: { in: [...a.bookings, ...b.bookings].map((x) => x.id) }, status: "ISSUED" } })).toBe(3);
  const logged = await db().activity.findFirst({ where: { entityId: c.bookings[0].id, action: "left out of the pay run" } });
  expect(logged?.detail).toBe("Didn't turn up");

  // Send for the records, then pay.
  const send = page.getByRole("button", { name: "Send to Harbour for our records" });
  await hydrated(send);
  await send.click();
  await expect(page.getByTestId("run-sent")).toContainText(`by ${HARBOUR.name}`, { timeout: 15_000 });

  await expect(page.getByTestId("run-progress")).toHaveText("0 of 2 paid · £0.00 of £1,050.00");
  const alpha = row(page, a.act.name);
  const paid = alpha.getByRole("button", { name: "Paid", exact: true });
  await hydrated(paid);
  await paid.click();
  await expect(alpha.getByTestId("pay-paid")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("run-progress")).toHaveText("1 of 2 paid · £800.00 of £1,050.00");

  const all = page.getByRole("button", { name: "Mark all paid" });
  await hydrated(all);
  await all.click();
  await page.getByRole("button", { name: "Yes, mark all paid" }).click();
  await expect(page.getByTestId("week-paid")).toBeVisible({ timeout: 15_000 });
});

test("signing off works on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const week = oldWeek();
  const a = await actWithGigs(stamp("E2E Phone Signoff A"), week, [0]);
  await actWithGigs(stamp("E2E Phone Signoff B"), week, [6], 30_000);

  await signIn(page, HARBOUR.email, HARBOUR.password);
  await expect(page).toHaveURL(/dashboard/, { timeout: 20_000 });
  await page.goto(`/payments/run?week=${week}`);
  const signOff = page.getByRole("button", { name: "Sign off the week" });
  await hydrated(signOff);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await signOff.click();
  await expect(page.getByTestId("run-signed-off")).toContainText("2 played", { timeout: 20_000 });

  const send = page.getByRole("button", { name: "Send to Harbour for our records" });
  await hydrated(send);
  await send.click();
  await expect(page.getByTestId("run-sent")).toBeVisible({ timeout: 15_000 });

  const alpha = row(page, a.act.name);
  const paid = alpha.getByRole("button", { name: "Paid", exact: true });
  await hydrated(paid);
  await paid.click();
  await expect(alpha.getByTestId("pay-paid")).toBeVisible({ timeout: 15_000 });
  const all = page.getByRole("button", { name: "Mark all paid" });
  await hydrated(all);
  await all.click();
  await page.getByRole("button", { name: "Yes, mark all paid" }).click();
  await expect(page.getByTestId("week-paid")).toBeVisible({ timeout: 15_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
