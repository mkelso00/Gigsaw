import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, db, seededAgency, stamp } from "./support/data";
import { hydrated } from "./support/ui";

/** Last month in London, as "YYYY-MM", and a day in it at 19:00 UTC. */
function lastMonth() {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const [y, m] = today.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 2, 1));
  const month = first.toISOString().slice(0, 7);
  return { month, day: (d: number) => new Date(`${month}-${String(d).padStart(2, "0")}T19:00:00Z`) };
}

test("a company with two venues gets one bill: ask for the PO, put it in, mark it invoiced and print it", async ({ page }) => {
  const { agencyId } = await seededAgency();
  const company = stamp("E2E Rekom");
  const email = `ap-${company.split(" ").pop()}@e2e-rekom.gigsaw.invalid`;
  const payer = await db().contact.create({ data: { agencyId, name: "Accounts team", company, email } });
  const act = await createAct(stamp("E2E Billing Act"));
  const pryzm = await createVenue(stamp("E2E Pryzm"));
  const atik = await createVenue(stamp("E2E Atik"));
  const { month, day } = lastMonth();
  for (const [venue, d] of [
    [pryzm, 8],
    [atik, 15],
  ] as const) {
    const setStart = day(d);
    const b = await createBooking({
      artistId: act.id,
      venueId: venue.id,
      status: "CONFIRMED",
      arriveBy: new Date(setStart.getTime() - 3_600_000),
      setStart,
      setEnd: new Date(setStart.getTime() + 2 * 3_600_000),
      feeMinor: 25_000,
      artistFeeMinor: 15_000,
    });
    await db().booking.update({ where: { id: b.id }, data: { promoterId: payer.id } });
  }

  // The company's page says how it's billed.
  await page.goto(`/contacts/${payer.id}`);
  await expect(page.getByTestId("client-billing")).toContainText("One bill for all their venues");

  // Monthly billing opens on last month, with one bill for both venues.
  await page.goto("/billing");
  await expect(page.getByTestId("billing-month")).toHaveText(new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" }));
  const bill = page.locator("details").filter({ has: page.getByTestId("bill-name").filter({ hasText: company }) });
  await expect(bill).toHaveCount(1);
  await expect(bill.getByTestId("bill-name")).toHaveText(`${company}: 2 venues`);
  await expect(bill).toContainText("2 gigs");
  await expect(bill).toContainText("£500.00");
  await expect(bill.getByTestId("bill-step")).toHaveText("Ask for PO");

  // Open it (it stays open after each save, even if the page reloads): both gigs, with links to the bookings.
  const summary = bill.locator("summary");
  await hydrated(summary);
  const open = async () => {
    // Once the page is live, so a reload's own reopening (from the address) has happened first.
    await hydrated(summary);
    if (!(await bill.evaluate((el) => (el as HTMLDetailsElement).open))) await summary.click();
    await expect(bill.getByRole("link", { name: "Print statement" })).toBeVisible();
  };
  await open();
  await expect(bill.getByRole("link", { name: pryzm.name })).toBeVisible();
  await expect(bill.getByRole("link", { name: atik.name })).toBeVisible();

  // Ask for the PO by email: the payer's address is filled in.
  const ask = bill.getByRole("button", { name: "Ask for PO" });
  await hydrated(ask);
  await expect(bill.getByLabel("Email the PO request to")).toHaveValue(email);
  await ask.click();
  await expect(bill.getByTestId("bill-step")).toHaveText("Waiting for PO", { timeout: 15_000 });
  const sent = await db().message.findFirst({ where: { agencyId, kind: "BILLING", to: email }, orderBy: { createdAt: "desc" } });
  expect(sent?.body).toContain(pryzm.name);
  expect(sent?.body).not.toContain("150.00"); // never the act's fee

  // The PO comes in.
  const po = `PO-${Date.now().toString(36).toUpperCase()}`;
  await open();
  const poBox = bill.getByLabel("PO number");
  await hydrated(poBox);
  await poBox.fill(po);
  await bill.getByRole("button", { name: "Save PO" }).click();
  await expect(bill.getByTestId("bill-step")).toHaveText("Ready to invoice", { timeout: 15_000 });
  await expect(bill.getByTestId("bill-po")).toHaveText(po);

  // Raised in Xero: mark it invoiced with the number.
  await open();
  const invoiceBox = bill.getByLabel("Invoice number");
  await hydrated(invoiceBox);
  await invoiceBox.fill("INV-E2E-1");
  await bill.getByRole("button", { name: "Mark invoiced" }).click();
  await expect(bill.getByTestId("bill-step")).toHaveText("Invoiced", { timeout: 15_000 });
  await expect(bill.getByTestId("bill-invoice")).toHaveText("INV-E2E-1");

  // The printed statement lists both venues' gigs with the PO and invoice number.
  await open();
  const printHref = await bill.getByRole("link", { name: "Print statement" }).getAttribute("href");
  await page.goto(printHref!);
  await expect(page.getByTestId("print-po")).toContainText(po);
  await expect(page.getByTestId("print-invoice")).toContainText("INV-E2E-1");
  await expect(page.getByText(pryzm.name, { exact: true })).toBeVisible();
  await expect(page.getByText(atik.name, { exact: true })).toBeVisible();
  await expect(page.getByText(company).first()).toBeVisible();

  // So does a venue's own statement for the month.
  const [from, to] = [`${month}-01`, new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)];
  await page.goto(`/print/venues/${atik.id}/statement?from=${from}&to=${to}`);
  await expect(page.getByTestId("print-po")).toContainText(po);
});

test("monthly billing fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/billing");
  await expect(page.getByTestId("billing-summary")).toBeVisible();
  // With a bill opened too (the seed has gigs last month, so there's at least one).
  const first = page.locator("details summary").first();
  await hydrated(first);
  await first.click();
  await expect(page.getByRole("link", { name: "Print statement" }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
