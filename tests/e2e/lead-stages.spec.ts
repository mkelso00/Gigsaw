import { expect, test } from "@playwright/test";
import { createBooking, db, seededAgency, someFutureDay, stamp } from "./support/data";
import { hydrated } from "./support/ui";

// The Leads page as a filter (src/app/(agency)/enquiries/page.tsx): a new lead is marked Customer contacted,
// then set aside as Not going ahead with a reason, which frees the date its Enquiry booking was holding.

test("a lead goes New → Contacted → Not going ahead, and its held date is freed", async ({ page }) => {
  const { agencyId } = await seededAgency();
  const name = stamp("E2E Stages Lead");
  const day = someFutureDay();
  const held = await createBooking({
    artistId: undefined as never,
    venueId: undefined as never,
    status: "ENQUIRY",
    arriveBy: new Date(`${day}T18:00:00Z`),
    setStart: new Date(`${day}T18:00:00Z`),
    setEnd: new Date(`${day}T22:00:00Z`),
  });
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.gigsaw.invalid`;
  const lead = await db().enquiry.create({ data: { agencyId, name, email, eventType: "PRIVATE_PARTY", date: day, bookingId: held.id } });

  await page.goto("/enquiries?view=new");
  const card = page.locator(`li[id="${lead.id}"]`);
  await expect(card.getByText("New", { exact: true })).toBeVisible();

  // Customer contacted: it leaves New for the Contacted tab.
  const contacted = card.getByRole("button", { name: "Customer contacted" });
  await hydrated(contacted);
  await contacted.click();
  await expect(card).toBeHidden();
  await page.getByRole("link", { name: /^Contacted/ }).click();
  await expect(page).toHaveURL(/view=contacted/);
  await expect(card.getByText("Contacted", { exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Customer contacted" })).toHaveCount(0);

  // Not going ahead, with a reason.
  await card.getByText("Not going ahead", { exact: true }).click();
  await card.getByLabel("Why?").selectOption("Over their budget");
  await card.getByLabel("A note (optional)").fill("Wanted a duo for £300");
  const aside = card.getByRole("button", { name: "Set it aside" });
  await hydrated(aside);
  await aside.click();
  await expect.poll(async () => (await db().enquiry.findUniqueOrThrow({ where: { id: lead.id } })).status, { timeout: 15_000 }).toBe("CLOSED");
  expect((await db().booking.findUniqueOrThrow({ where: { id: held.id } })).status).toBe("CANCELLED");

  await page.goto("/enquiries?view=closed");
  await expect(card.getByText("Over their budget: Wanted a duo for £300")).toBeVisible();
  await expect(card.getByRole("button", { name: "Back to new" })).toBeVisible();
});
