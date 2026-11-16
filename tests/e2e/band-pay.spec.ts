import { expect, test } from "@playwright/test";
import { ADMIN_STATE } from "./support/env";
import { createAct, createBooking, createMemberLogin, createVenue, db, stamp } from "./support/data";
import { hydrated, signIn } from "./support/ui";

// A band's pay: each member fills in their own details from their own login (on their person, not the
// band), staff choose who the band's invoices go to, and the invoice is made out to that person and
// paid into their account. The rest of the band never see the band's money.

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const LEAD_ACCOUNT = "55667788";
const MEMBER_ACCOUNT = "31926819";

test("a band member adds their own details, staff choose the lead, and the invoice is made out to the lead", async ({ page, browser }) => {
  const tag = stamp("");
  const name = stamp("E2E Band");
  const act = await createAct(name);
  const lead = await createMemberLogin(act.id, "Lena", `Lead${tag}`, { details: LEAD_ACCOUNT });
  const member = await createMemberLogin(act.id, "Max", `Member${tag}`);
  const venue = await createVenue(stamp("E2E Band Hall"));
  const now = Date.now();
  // A gig that finished an hour ago.
  const booking = await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "CONFIRMED",
    arriveBy: new Date(now - 4 * 3_600_000),
    setStart: new Date(now - 3 * 3_600_000),
    setEnd: new Date(now - 3_600_000),
    feeMinor: 120_000,
    artistFeeMinor: 80_000,
  });

  // 1. A member signs in: their own details come first, and they go on their person, not the band.
  await signIn(page, member.email, member.password);
  await expect(page).toHaveURL(/\/app\/details$/, { timeout: 20_000 });
  const save = page.getByRole("button", { name: "Save and see my bookings" });
  await hydrated(save);
  await page.getByLabel("Name on the account").fill("Max Member");
  await page.getByLabel("Sort code").fill("308012");
  await page.getByLabel("Account number").fill(MEMBER_ACCOUNT);
  await page.getByLabel("Postal address").fill("2 Drum Road\nLeeds");
  await save.click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  expect(await db().person.findUniqueOrThrow({ where: { id: member.person.id } })).toMatchObject({ bankAccountNumber: MEMBER_ACCOUNT });
  expect(await db().artist.findUniqueOrThrow({ where: { id: act.id } })).toMatchObject({ bankAccountNumber: "", detailsCompletedAt: null });

  // 2. Staff choose who the band's invoices go to, then make the invoice.
  const staff = await browser.newContext({ storageState: ADMIN_STATE });
  let number = "";
  try {
    const p = await staff.newPage();
    await p.goto(`/artists/${act.id}`);
    await expect(p.getByTestId("choose-lead")).toBeVisible();
    await expect(p.getByText("2 of 2 signed up")).toBeVisible();
    const people = p.locator("#members");
    await expect(people.getByText("Details in")).toHaveCount(2);
    const card = p.getByTestId("pay-details");
    const choose = card.getByRole("button", { name: "Save" });
    await hydrated(choose);
    await card.getByLabel("Invoices go to").selectOption({ label: `Lena Lead${tag}` });
    await choose.click();
    await expect(card.getByRole("status")).toContainText(`now go to Lena Lead${tag}`, { timeout: 20_000 });
    await p.reload();
    await expect(p.getByTestId("choose-lead")).toHaveCount(0);
    await expect(people.getByText("Invoices go to them")).toHaveCount(1);
    await expect(card.getByText(LEAD_ACCOUNT)).toBeVisible();

    await p.goto(`/payments/acts?act=${act.id}`);
    const make = p.getByRole("region", { name: "Not invoiced yet" }).getByRole("button", { name: "Make invoice" });
    await hydrated(make);
    await make.click();
    await expect(p.getByRole("status").filter({ hasText: /Invoice SB-\d+ made/ })).toBeVisible({ timeout: 20_000 });
    const invoice = await db().actInvoice.findUniqueOrThrow({ where: { liveBookingId: booking.id } });
    expect(invoice).toMatchObject({ payeePersonId: lead.person.id, payeeName: `Lena Lead${tag}`, bankAccountNumber: LEAD_ACCOUNT, actName: name });
    number = invoice.number;
    await p.reload();
    const group = p.getByRole("region", { name });
    await expect(group.getByTestId("payee")).toContainText(`Made out to Lena Lead${tag}`);
    await expect(group).toContainText(LEAD_ACCOUNT);
    await expect(group).not.toContainText(MEMBER_ACCOUNT);
  } finally {
    await staff.close();
  }

  // 3. The member doesn't see the band's money: no invoice, just who it goes to.
  await page.goto("/app/invoices");
  await expect(page.getByText(`${name}'s invoices are made out to Lena Lead${tag}`)).toBeVisible();
  await expect(page.getByRole("link", { name: /SB-\d+/ })).toHaveCount(0);
  const invoice = await db().actInvoice.findUniqueOrThrow({ where: { liveBookingId: booking.id } });
  const hidden = await page.goto(`/print/act-invoices/${invoice.id}`);
  expect(hidden?.status()).toBe(404);

  // 4. The lead sees it, made out to them, for the act's fee only.
  await page.context().clearCookies();
  await signIn(page, lead.email, lead.password);
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await page.goto("/app/invoices");
  const row = page.getByRole("link", { name: new RegExp(number) });
  await expect(row).toContainText("£800.00");
  await expect(page.getByText("£1,200")).toHaveCount(0);
  await page.goto(`/print/act-invoices/${invoice.id}`);
  await expect(page.getByText(`on behalf of Lena Lead${tag}`)).toBeVisible();
  await expect(page.getByText("••••7788")).toBeVisible();
});
