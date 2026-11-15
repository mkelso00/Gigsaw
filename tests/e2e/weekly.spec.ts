import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, dayFromToday, db, seededAgency, stamp } from "./support/data";
import { expectAfterSave, hydrated, pickFromCombobox } from "./support/ui";

// Weekly work: VAT on sales by default, "Repeat every week" on the quick booking form, weekly
// slots at a venue (start date, several days, stop and delete) and copying a booking every week.

const DAY = 86_400_000;

test("VAT on sales: set once in Settings, filled in on a new booking", async ({ page }) => {
  const { agencyId } = await seededAgency();
  try {
    await page.goto("/settings/booking-fee");
    await expect(page.getByRole("heading", { level: 1, name: "Booking fee and VAT" })).toBeVisible();
    const vat = page.getByLabel("VAT %");
    await hydrated(vat);
    await vat.fill("20");
    await page.getByRole("button", { name: "Save" }).click();
    await expect.poll(async () => (await db().settings.findUniqueOrThrow({ where: { agencyId } })).defaultVatPct).toBe(20);

    await page.goto("/bookings/new");
    const create = page.getByRole("button", { name: "Create booking" });
    await hydrated(create);
    const form = page.locator("form").filter({ has: create });
    await expect(form.locator('input[name="vatPct"]')).toHaveValue("20");
    await form.locator('input[name="fee"]').fill("300");
    // Shown in the summary without opening More money options.
    await expect(form.getByText("+ £60.00 VAT")).toBeVisible();
  } finally {
    // Other tests share the demo agency: put it back.
    await db().settings.update({ where: { agencyId }, data: { defaultVatPct: 0 } });
  }
});

test("quick booking: Repeat every week makes a booking each week from the date", async ({ page }) => {
  const act = await createAct(stamp("E2E Weekly Act"));
  const venue = await createVenue(stamp("E2E Weekly Inn"));
  const first = dayFromToday(70);

  await page.goto("/dashboard");
  const open = page.getByRole("button", { name: "New booking" });
  await hydrated(open);
  await open.click();
  const dialog = page.getByRole("dialog", { name: "New booking" });
  await pickFromCombobox(page, dialog.getByLabel("Act", { exact: true }), act.name);
  await pickFromCombobox(page, dialog.getByLabel("Venue", { exact: true }), venue.name);
  await dialog.getByLabel("Date", { exact: true }).fill(first);
  await dialog.getByRole("checkbox", { name: /^Repeat every / }).check();
  await dialog.getByLabel("Number of weeks").fill("3");
  await expect(dialog.getByText(/^3 bookings, every \w+ from /)).toBeVisible();
  await dialog.getByRole("button", { name: "Book 3" }).click();
  await expectAfterSave(page, dialog.getByText(new RegExp(`^Booked ${act.name} at ${venue.name}, 3 bookings, every \\w+ from `)));

  const made = await db().booking.findMany({ where: { artistId: act.id }, orderBy: { arriveBy: "asc" } });
  expect(made).toHaveLength(3);
  expect(made.map((b) => b.arriveBy.toISOString().slice(0, 10))).toEqual([first, dayFromToday(77), dayFromToday(84)]);
  expect(made.every((b) => b.venueId === venue.id && b.slotId === null)).toBe(true);
  // No weekly slot at the venue, so nothing asks every week.
  expect(await db().venueSlot.count({ where: { venueId: venue.id } })).toBe(0);
});

test("venue schedule: weekly slots from a start date on several days, then stop one and delete the other", async ({ page }) => {
  const venue = await createVenue(stamp("E2E Rota Lounge"));
  const start = dayFromToday(40);
  page.on("dialog", (d) => d.accept());

  await page.goto(`/venues/${venue.id}`);
  const add = page.getByRole("button", { name: "Add weekly slot" });
  await hydrated(add);
  const form = page.locator("form").filter({ has: add });
  await form.getByText("Mon", { exact: true }).click();
  await form.getByText("Wed", { exact: true }).click();
  await form.getByLabel("Starts on").fill(start);
  await add.click();
  await expectAfterSave(page, page.getByText(/^Added: every Mon, Wed from /));
  await expect.poll(() => db().venueSlot.count({ where: { venueId: venue.id, startsOn: start } })).toBe(2);

  // Stop the Monday one.
  const monday = page.locator("details").filter({ hasText: "Every Monday" });
  await monday.locator("summary").click();
  const stop = monday.getByRole("button", { name: "Stop it" });
  await hydrated(stop);
  await monday.getByLabel("Last date it runs").fill(dayFromToday(60));
  await stop.click();
  await expectAfterSave(page, page.getByText(/^Stopped: the last one is /));
  const slots = await db().venueSlot.findMany({ where: { venueId: venue.id }, orderBy: { weekday: "asc" } });
  expect(slots[0].endsOn).toBe(dayFromToday(60));

  // Delete the Wednesday one: nothing was booked from it.
  await page.reload();
  const wednesday = page.locator("details").filter({ hasText: "Every Wednesday" });
  await wednesday.locator("summary").click();
  const del = wednesday.getByRole("button", { name: "Delete slot" });
  await hydrated(del);
  await del.click();
  await expect.poll(() => db().venueSlot.count({ where: { venueId: venue.id } })).toBe(1);
});

test("rota: a weekly slot shows from its start date, not from this week", async ({ page }) => {
  const venue = await createVenue(stamp("E2E Later Bar"));
  const { agencyId } = await seededAgency();
  // A Wednesday slot starting four weeks on (the Monday of that week, as the rota's ?week= wants).
  const start = new Date(Date.now() + 28 * DAY);
  const monday = new Date(start.getTime() - ((start.getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
  await db().venueSlot.create({
    data: { agencyId, venueId: venue.id, weekday: 3, arriveTime: "18:30", startTime: "19:00", endTime: "21:00", label: "Later", startsOn: monday },
  });

  await page.goto("/rota");
  await expect(page.getByRole("heading", { level: 1, name: "Rota" })).toBeVisible();
  await expect(page.getByRole("link", { name: venue.name })).toHaveCount(0);

  await page.goto(`/rota?week=${monday}`);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: venue.name }) });
  await expect(row).toBeVisible();
  // Its "weekly" label opens the slot on the venue's page, to change or stop it.
  await row.getByRole("link", { name: "Later · weekly" }).click();
  await expect(page.getByRole("button", { name: "Stop it" })).toBeVisible({ timeout: 15_000 });
});

test("copy a booking to the same day every week", async ({ page }) => {
  const act = await createAct(stamp("E2E Copy Act"));
  const venue = await createVenue(stamp("E2E Copy Club"));
  const day = Date.now() + 30 * DAY;
  const booking = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "PENDING",
    arriveBy: new Date(day),
    setStart: new Date(day + 3_600_000),
    setEnd: new Date(day + 3 * 3_600_000),
  });

  // On a phone, where Copy is in the "⋯" menu that closes as soon as it's tapped.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/bookings/${booking.id}`);
  const more = page.getByRole("button", { name: "More actions" });
  await hydrated(more);
  await more.click();
  const copy = page.getByRole("button", { name: "Copy", exact: true });
  await hydrated(copy);
  await copy.click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Number of weeks").fill("5");
  await dialog.getByRole("button", { name: "Pick them" }).click();
  await expect(dialog.getByText(/^5 dates picked, the last on /)).toBeVisible();
  await dialog.getByRole("button", { name: "Copy to 5 dates" }).click();
  await expect(dialog.getByText(/^Copied to 5 dates as Pending\./)).toBeVisible({ timeout: 20_000 });
  expect(await db().booking.count({ where: { artistId: act.id } })).toBe(6);
});
