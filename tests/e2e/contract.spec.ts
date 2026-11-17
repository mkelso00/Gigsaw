import { expect, test } from "@playwright/test";
import { createAct, createBooking, createVenue, db, stamp } from "./support/data";
import { hydrated, linkFromCopyField } from "./support/ui";

test("the client signs and approves the contract online, and the booking shows their signature", async ({ page, browser }) => {
  const act = await createAct(stamp("E2E Contract Act"));
  const venue = await createVenue(stamp("E2E Contract Barn"));
  const day = Date.now() + 50 * 86_400_000;
  const booking = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "HOLD",
    arriveBy: new Date(day),
    setStart: new Date(day + 2 * 3_600_000),
    setEnd: new Date(day + 4 * 3_600_000),
    feeMinor: 150_000,
  });

  // Staff send it from the Contract box: no printing.
  await page.goto(`/bookings/${booking.id}#contract`);
  const contractBox = page.locator("#contract");
  await contractBox.getByLabel("Who signs").fill("Hannah Smith");
  await contractBox.getByLabel("Their email").fill(`hannah-${Date.now()}@contract.gigsaw.invalid`);
  const send = contractBox.getByRole("button", { name: "Send contract to sign" });
  await hydrated(send);
  await send.click();
  const link = await linkFromCopyField(page, "/c/");

  // The client opens the link: no login, nothing to download.
  const client = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const p = await client.newPage();
    await p.goto(link);
    await expect(p.getByRole("heading", { name: "Sign and approve" })).toBeVisible();
    await expect(p.getByText("Signed online by the client")).toBeVisible();
    // Draw a signature in the box.
    const pad = p.getByLabel("Signature box: draw your signature here");
    await pad.scrollIntoViewIfNeeded();
    const box = (await pad.boundingBox())!;
    await p.mouse.move(box.x + 20, box.y + box.height / 2);
    await p.mouse.down();
    for (let i = 1; i <= 12; i++) await p.mouse.move(box.x + 20 + i * 18, box.y + box.height / 2 + (i % 2 ? -20 : 20), { steps: 3 });
    await p.mouse.up();
    await p.getByRole("checkbox").check();
    const approve = p.getByRole("button", { name: "Approve", exact: true });
    await hydrated(approve);
    await approve.click();
    await expect(p.getByText(/Approved and signed/)).toBeVisible({ timeout: 15_000 });
    await expect(p.getByRole("img", { name: "Signature of Hannah Smith" })).toBeVisible();
  } finally {
    await client.close();
  }

  // Back on the booking: approved, booked (Pending until the act is confirmed), signature on show.
  await expect.poll(async () => (await db().booking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("PENDING");
  await page.goto(`/bookings/${booking.id}`);
  await expect(page.locator("#contract").getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.locator("#contract").getByRole("img", { name: "Signature of Hannah Smith" })).toBeVisible();
});
