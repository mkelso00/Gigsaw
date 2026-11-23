import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createBooking, createWedding, db, dayFromToday, seededAgency, someFutureDay, stamp } from "./support/data";
import { hydrated } from "./support/ui";

// A lead whose proposal lapses stops holding the date (src/lib/lapsed-leads.ts): declined by the customer,
// or expired with no reply. Staff see which it was on a phone: the proposal's status, what was cancelled,
// and the reason on the booking and the wedding.

const PHONE = { width: 390, height: 844 };

/** A lead as the enquiry form makes it, with its proposal out with the customer. */
async function leadWithProposal(o: { name: string; bookingId?: string; eventId?: string; validUntil: string; eventType: string }) {
  const { agencyId, adminId } = await seededAgency();
  const email = `${o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.gigsaw.invalid`;
  const contact = await db().contact.create({ data: { agencyId, name: o.name, email, type: "CLIENT" } });
  const date = someFutureDay();
  const enquiry = await db().enquiry.create({
    data: { agencyId, name: o.name, email, eventType: o.eventType, date, contactId: contact.id, bookingId: o.bookingId, eventId: o.eventId, status: "DONE" },
  });
  const token = randomBytes(24).toString("base64url");
  const quote = await db().quote.create({
    data: {
      agencyId,
      number: `QE-${randomBytes(4).toString("hex")}`,
      enquiryId: enquiry.id,
      contactId: contact.id,
      agentId: adminId,
      title: `${o.name}'s ${o.eventType === "WEDDING" ? "wedding" : "party"}`,
      eventType: o.eventType,
      status: "SENT",
      sentAt: new Date(),
      sentTo: email,
      token,
      tokenExpiresAt: new Date(Date.now() + 400 * 86_400_000),
      validUntil: o.validUntil,
      lines: { create: [{ sort: 0, date, startTime: "19:00", endTime: "23:00", place: "Home Farm", saleMinor: 150_000, costMinor: 110_000 }] },
    },
  });
  return { quote, token };
}

/** Nothing on the page is wider than the phone. */
async function fitsThePhone(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("a declined proposal cancels the lead's held wedding, and says so on a phone", async ({ page, browser }) => {
  await page.setViewportSize(PHONE);
  const name = stamp("E2E Declined Lead");
  const wedding = await createWedding(`${name}'s wedding`);
  const held = await createBooking({
    artistId: (await db().artist.create({ data: { agencyId: wedding.agencyId, name: stamp("E2E Held Band") } })).id,
    venueId: (await db().venue.create({ data: { agencyId: wedding.agencyId, name: stamp("E2E Barn"), city: "York", timezone: "Europe/London" } })).id,
    status: "HOLD",
    arriveBy: new Date(`${wedding.date}T17:00:00Z`),
    setStart: new Date(`${wedding.date}T18:00:00Z`),
    setEnd: new Date(`${wedding.date}T22:00:00Z`),
  });
  await db().booking.update({ where: { id: held.id }, data: { eventId: wedding.id } });
  const { quote, token } = await leadWithProposal({ name, eventId: wedding.id, validUntil: dayFromToday(14), eventType: "WEDDING" });

  // The customer says no thanks.
  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: PHONE });
  try {
    const c = await customer.newPage();
    await c.goto(`/q/${token}`);
    await c.getByText("No thanks, decline this proposal").click();
    const decline = c.getByRole("button", { name: "Decline the proposal" });
    await hydrated(decline);
    await decline.click();
    await expect(c.getByText("You've declined this proposal.")).toBeVisible({ timeout: 15_000 });
  } finally {
    await customer.close();
  }

  // Staff: the status reads plainly, and what was cancelled is listed. (The cancelling runs just after the customer's answer.)
  await expect(async () => {
    await page.goto(`/quotes/${quote.id}`);
    await expect(page.getByText(`Cancelled ${held.reference} and the wedding, so the date isn't held for them any more.`)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  await expect(page.getByText("Declined by customer").first()).toBeVisible();
  await fitsThePhone(page);

  await page.goto(`/events/${wedding.id}`);
  await expect(page.getByText("Cancelled: Proposal declined by the customer.")).toBeVisible();
  await page.goto(`/bookings/${held.id}`);
  await expect(page.getByText("Cancelled · Proposal declined by the customer")).toBeVisible();
});

test("an expired proposal cancels the lead's Enquiry booking, and the Proposals filter says Expired: no reply", async ({ page }) => {
  await page.setViewportSize(PHONE);
  const name = stamp("E2E Quiet Lead");
  const { agencyId } = await seededAgency();
  const day = someFutureDay();
  const enquiryGig = await createBooking({
    artistId: undefined as never,
    venueId: undefined as never,
    status: "ENQUIRY",
    arriveBy: new Date(`${day}T18:00:00Z`),
    setStart: new Date(`${day}T18:00:00Z`),
    setEnd: new Date(`${day}T22:00:00Z`),
  });
  expect(enquiryGig.agencyId).toBe(agencyId);
  const { quote, token } = await leadWithProposal({ name, bookingId: enquiryGig.id, validUntil: dayFromToday(-2), eventType: "PRIVATE_PARTY" });

  // The customer opens their link after it ran out: saved as Expired there and then.
  const c = await page
    .context()
    .browser()!
    .newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const p = await c.newPage();
    await p.goto(`/q/${token}`);
    await expect(p.getByText("This proposal has expired.")).toBeVisible();
  } finally {
    await c.close();
  }

  await page.goto(`/quotes/${quote.id}`);
  await expect(page.getByText(`Cancelled ${enquiryGig.reference}, so the date isn't held for them any more.`)).toBeVisible();
  await expect(page.getByText("Expired: no reply").first()).toBeVisible();
  await fitsThePhone(page);
  await page.goto(`/bookings/${enquiryGig.id}`);
  await expect(page.getByText("Cancelled · Proposal expired, no reply")).toBeVisible();

  // The Proposals tab's stage tabs use the same words.
  await page.goto(`/enquiries?view=quotes&status=EXPIRED&q=${encodeURIComponent(name)}`);
  const filters = page.getByRole("button", { name: /Filters/ });
  await hydrated(filters);
  await filters.click();
  await expect(page.getByRole("navigation", { name: "Proposals by stage" }).getByRole("link", { name: /^Expired: no reply \d+$/ })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(page.getByRole("link", { name: new RegExp(name) }).getByText("Expired: no reply")).toBeVisible();
  await fitsThePhone(page);
});
