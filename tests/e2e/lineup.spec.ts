import bcrypt from "bcryptjs";
import { expect, test } from "@playwright/test";
import { createAct, createBooking, createMemberLogin, createVenue, db, seededAgency, stamp } from "./support/data";
import { ADMIN_STATE } from "./support/env";
import { hydrated, signIn } from "./support/ui";

// A band's singer is ill: staff take them off this one gig and bring in a stand-in. The stand-in sees the gig
// in their own app (never the band's fee); the singer no longer does.
test.use({ storageState: { cookies: [], origins: [] } });

test("take a member off one gig and bring in a stand-in", async ({ page, browser }) => {
  const tag = stamp("").replace(/\s+/g, "");
  const act = await createAct(stamp("E2E Lineup Band"));
  const singer = await createMemberLogin(act.id, "Sam", `Singer${tag}`, { details: "11112222" });
  await createMemberLogin(act.id, "Pat", `Player${tag}`, { details: "33334444" });
  // A dep who isn't in the band, with their own login and details in.
  const { agencyId } = await seededAgency();
  const depEmail = `dana-dep-${tag}@e2e.gigsaw.invalid`.toLowerCase();
  const dep = await db().person.create({
    data: {
      agencyId,
      firstName: "Dana",
      surname: `Dep${tag}`,
      email: depEmail,
      bankAccountName: "Dana Dep",
      bankSortCode: "10-20-30",
      bankAccountNumber: "55556666",
      address: "3 Dep Lane\nYork",
      detailsCompletedAt: new Date(),
    },
  });
  await db().user.create({
    data: {
      email: depEmail,
      name: "Dana Dep",
      role: "ARTIST",
      agencyId,
      personId: dep.id,
      passwordHash: await bcrypt.hash("e2e-password-123", 10),
      calendarAddedAt: new Date(),
    },
  });
  const venue = await createVenue(stamp("E2E Lineup Rooms"));
  const day = Date.now() + 20 * 86_400_000;
  const b = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "CONFIRMED",
    arriveBy: new Date(day),
    setStart: new Date(day + 3_600_000),
    setEnd: new Date(day + 3 * 3_600_000),
    feeMinor: 100_000,
    artistFeeMinor: 60_000,
  });

  // Staff: Sam off, Dana in.
  const staff = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const p = await staff.newPage();
    await p.goto(`/bookings/${b.id}`);
    const box = p.locator("#lineup");
    const samRow = box.getByRole("listitem").filter({ hasText: `Sam Singer${tag}` });
    const off = samRow.getByRole("button", { name: "Off this gig" });
    await hydrated(off);
    await off.click();
    await expect(samRow.getByRole("button", { name: "Back on" })).toBeVisible({ timeout: 15_000 });
    await box.getByText("Add a stand-in").click();
    await box.getByLabel("Someone already in Gigsaw").selectOption({ label: `Dana Dep${tag}` });
    const add = box.getByRole("button", { name: "Add stand-in" });
    await hydrated(add);
    await add.click();
    await expect(
      box
        .getByRole("listitem")
        .filter({ hasText: `Dana Dep${tag}` })
        .getByText("Standing in"),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await staff.close();
  }

  // Dana sees the gig, standing in, with no fee.
  await signIn(page, depEmail, "e2e-password-123");
  await expect(page).toHaveURL(/\/app/, { timeout: 20_000 });
  await page.goto(`/app/gigs/${b.id}`);
  await expect(page.getByText(/You're standing in with/)).toBeVisible();
  await expect(page.getByText("£600.00")).toHaveCount(0);

  // Sam no longer does.
  const samCtx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const s = await samCtx.newPage();
    await signIn(s, singer.email, singer.password);
    await expect(s).toHaveURL(/\/app/, { timeout: 20_000 });
    // Not in their bookings list, and the gig's page isn't theirs to open.
    await expect(s.getByText(venue.name)).toHaveCount(0);
    await s.goto(`/app/gigs/${b.id}`);
    await expect(s.getByText("We can't find that page")).toBeVisible();
  } finally {
    await samCtx.close();
  }
});
