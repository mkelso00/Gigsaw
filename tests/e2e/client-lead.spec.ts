import { expect, test } from "@playwright/test";
import { ADMIN } from "./support/env";
import { createAct, createVenue, db, seededAgency, someFutureDay, stamp } from "./support/data";
import { follow, hydrated, pickFromCombobox } from "./support/ui";

// The client's lead contact (src/lib/client-recipient.ts): choose a venue's lead contact for bookings on its page, and a
// new booking there shows them as who the client's messages go to, with who booked it beside the lead agent.

test("a venue's lead contact for bookings is used on a new booking there", async ({ page }) => {
  const { agencyId } = await seededAgency();
  const act = await createAct(stamp("E2E Lead Act"));
  const venue = await createVenue(stamp("E2E Lead Arms"));
  const tag = stamp("lead").replace(/\W+/g, "-");
  const sam = await db().person.create({
    data: { agencyId, venueId: venue.id, firstName: "Sam", surname: `Manager ${tag}`, jobTitle: "Bar manager", email: `sam-${tag}@e2e.gigsaw.invalid` },
  });
  await db().person.create({ data: { agencyId, venueId: venue.id, firstName: "Owen", surname: `Owner ${tag}`, jobTitle: "Owner" } });
  const samName = `Sam Manager ${tag}`;

  // On the venue's page: choose Sam.
  await page.goto(`/venues/${venue.id}`);
  const people = page.locator("#people");
  const save = people.getByRole("button", { name: "Save" });
  await hydrated(save);
  await people.getByLabel("Lead contact for bookings").selectOption({ label: `${samName}, Bar manager` });
  await save.click();
  await expect(people.getByText(`Saved. ${samName} gets the client's messages for bookings here.`)).toBeVisible({ timeout: 15_000 });
  await expect(people.getByText("Lead contact", { exact: true })).toBeVisible();
  expect((await db().venue.findUniqueOrThrow({ where: { id: venue.id } })).leadContactId).toBe(sam.id);

  // A new booking at the venue: the lead contact picker follows the venue, and Automatic means Sam.
  await page.goto("/bookings/new");
  const create = page.getByRole("button", { name: "Create booking" });
  await hydrated(create);
  // The quick New booking pop-up is in the page too, so look only inside this form.
  const form = page.locator("form").filter({ has: create });
  const lead = form.getByLabel("Client's lead contact");
  await expect(lead.locator("option:checked")).toHaveText("Automatic: nobody yet");
  await pickFromCombobox(page, form.getByLabel("Act", { exact: true }), act.name);
  await pickFromCombobox(page, form.getByLabel("Venue", { exact: true }), venue.name);
  await expect(lead.locator("option:checked")).toHaveText(`Automatic: ${samName}, ${venue.name}'s lead contact`);
  // Everyone at the venue can be chosen instead, or someone new.
  await expect(lead.locator("optgroup", { hasText: "Owen" })).toHaveAttribute("label", `At ${venue.name}`);
  await expect(lead.locator("option", { hasText: "Someone new" })).toHaveCount(1);
  const eventName = stamp("E2E Lead Night");
  await form.getByLabel("Event name").fill(eventName);
  await form.getByLabel("Date", { exact: true }).fill(someFutureDay());
  await form.getByLabel("Start", { exact: true }).fill("20:00");
  await create.click();
  await expect(page).toHaveURL(/\/bookings\/[^/]+$/, { timeout: 20_000 });

  // The booking's page: Sam, as the venue's lead contact, and who booked it beside the lead agent.
  const shown = page.getByTestId("client-lead");
  await expect(shown).toContainText(samName);
  await expect(shown).toContainText(`(${venue.name}'s lead contact)`);
  await expect(shown.getByRole("link", { name: samName })).toHaveAttribute("href", `/people/${sam.id}`);
  const admin = await db().user.findUniqueOrThrow({ where: { email: ADMIN.email } });
  await expect(page.getByTestId("lead-agent")).toContainText(`Booked by ${admin.name}`);
  // Left on Automatic: the booking names nobody itself, so a change at the venue reaches it.
  expect((await db().booking.findFirstOrThrow({ where: { eventName } })).clientContactId).toBeNull();
  await follow(page, shown.getByRole("link", { name: samName }), page.getByRole("heading", { level: 1, name: samName }));
});
