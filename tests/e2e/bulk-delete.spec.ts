import { expect, test } from "@playwright/test";
import { createAct, createBooking, db, stamp } from "./support/data";
import { hydrated } from "./support/ui";

test("gigs added with no venue: find them all with the No venue filter and delete them in one go", async ({ page }) => {
  const act = await createAct(stamp("E2E No Venue Act"));
  const name = stamp("E2E No venue run");
  const at = (days: number) => {
    const setStart = new Date(Date.now() + days * 86_400_000);
    return { arriveBy: new Date(setStart.getTime() - 3_600_000), setStart, setEnd: new Date(setStart.getTime() + 7_200_000) };
  };
  const gigs: { id: string; reference: string }[] = [];
  for (const d of [20, 27, 34]) gigs.push(await createBooking({ artistId: act.id, venueId: null, status: "PENDING", ...at(d) }));
  await db().booking.updateMany({ where: { id: { in: gigs.map((g) => g.id) } }, data: { eventName: name } });
  // One of them has a payment: it's archived, not deleted, so no money is lost.
  await db().payment.create({ data: { bookingId: gigs[2].id, direction: "IN", kind: "DEPOSIT", amountMinor: 5_000, paidAt: new Date() } });

  await page.goto(`/bookings?venue=none&q=${encodeURIComponent(name)}`);
  await expect(page.getByRole("row").filter({ hasText: "No venue" })).toHaveCount(3);
  const del = page.getByRole("button", { name: "Delete selected" });
  await hydrated(del);
  for (const g of gigs) await page.getByRole("checkbox", { name: `Select ${g.reference}` }).check();
  page.once("dialog", (d) => d.accept());
  await del.click();

  // The outcome first (a reload after saving can clear the note before it's seen), then the note if it's there.
  await expect.poll(() => db().booking.count({ where: { id: { in: gigs.map((g) => g.id) } } }), { timeout: 20_000 }).toBe(1);
  await expect(page).toHaveURL(/venue=none/);
  expect((await db().booking.findUniqueOrThrow({ where: { id: gigs[2].id } })).archivedAt).not.toBeNull();
});
