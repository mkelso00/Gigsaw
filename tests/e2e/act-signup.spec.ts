import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ADMIN_STATE } from "./support/env";
import { createAct, createBooking, createVenue, db, stamp } from "./support/data";
import { hydrated } from "./support/ui";

// An act the agency already has an email for sets up their own login: types the email at
// "First time? Set up your login", opens the link, makes a password, has to fill in Your details
// (bank, address, NI number) and then reaches their bookings. The agency then sees the details as
// complete; an agent sees that, but never the numbers.

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const ACCOUNT = "31926819";
const NI = "JG103726A";

test("an act sets up their login by email, fills in their details and reaches their gigs", async ({ page, browser }) => {
  const name = stamp("E2E Signup Act");
  const email = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.gigsaw.invalid`;
  const act = await createAct(name);
  await db().artist.update({ where: { id: act.id }, data: { email } });
  const venue = await createVenue(stamp("E2E Signup Club"));
  const now = Date.now();
  await createBooking({
    artistId: act.id,
    venueId: venue.id,
    status: "CONFIRMED",
    arriveBy: new Date(now + 5 * 86_400_000),
    setStart: new Date(now + 5 * 86_400_000 + 2 * 3_600_000),
    setEnd: new Date(now + 5 * 86_400_000 + 4 * 3_600_000),
  });

  // 1. From the sign-in page to "Set up your login", and type the email.
  await page.goto("/login");
  await page.getByRole("link", { name: "Set up your login" }).click();
  await expect(page.getByRole("heading", { name: "Set up your login" })).toBeVisible();
  const send = page.getByRole("button", { name: "Send me a link" });
  await hydrated(send);
  await page.getByLabel("Email").fill(email.toUpperCase());
  await send.click();
  await expect(page.getByRole("status")).toContainText("If that email is on file with an agency on Gigsaw, we've sent a link");

  // 2. The link. Only its hash is stored (and the outbox copy hides it), so the test gives the
  // link that was just issued a token of its own: same row, same expiry, still single-use.
  // The link is made just after the page answers, so wait for it.
  const issued = () => db().passwordReset.findFirst({ where: { user: { email } }, orderBy: { createdAt: "desc" }, include: { user: true } });
  await expect.poll(async () => !!(await issued()), { timeout: 15_000 }).toBe(true);
  const reset = (await issued())!;
  expect(reset.user).toMatchObject({ artistId: act.id, role: "ARTIST", passwordHash: "" });
  const token = randomBytes(32).toString("base64url");
  await db().passwordReset.update({ where: { id: reset.id }, data: { tokenHash: createHash("sha256").update(token).digest("hex") } });

  // 3. Make a password.
  await page.goto(`/reset-password/${token}?claim=1`);
  await expect(page.getByRole("heading", { name: "Create your password" })).toBeVisible();
  const create = page.getByRole("button", { name: "Create password" });
  await hydrated(create);
  await page.getByLabel(/^Password/).fill("my-own-password-1");
  await page.getByLabel("Type it again").fill("my-own-password-1");
  await create.click();

  // 4. Your details comes first, and nothing else opens until it's done.
  await expect(page).toHaveURL(/\/app\/details$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Your details" })).toBeVisible();
  await expect(page.getByText("This is how you'll get paid from now on.")).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/details$/);

  const save = page.getByRole("button", { name: "Save and see my bookings" });
  await hydrated(save);
  await page.getByLabel("Name on the account").fill(name);
  await page.getByLabel("Sort code").fill("308012");
  await page.getByLabel("Account number").fill(ACCOUNT);
  await page.getByLabel("Postal address").fill("12 Canal Street\nManchester\nM1 3HE");
  await page.getByLabel("National Insurance number").fill("QQ 12 34 56 C");
  await expect(page.getByText("This is for our records only.")).toBeVisible();
  await save.click();
  await expect(page.getByRole("alert").filter({ hasText: "Check the National Insurance number" })).toBeVisible();
  await page.getByLabel("National Insurance number").fill("jg 10 37 26 a");
  await save.click();

  // 5. Then their gigs have to go into a calendar. A calendar app fetching their feed ticks that off.
  await expect(page).toHaveURL(/\/app\/add-calendar$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Add your gigs to your calendar" })).toBeVisible();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/app\/add-calendar$/);
  const { calendarToken } = await db().artist.findUniqueOrThrow({ where: { id: act.id }, select: { calendarToken: true } });
  expect((await page.request.get(`/api/calendar/${calendarToken}.ics`)).status()).toBe(200);
  await page.reload();

  // 6. Their bookings.
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  await expect(page.getByText(venue.name)).toBeVisible({ timeout: 15_000 });
  const saved = await db().artist.findUniqueOrThrow({ where: { id: act.id } });
  expect(saved).toMatchObject({ bankSortCode: "30-80-12", bankAccountNumber: ACCOUNT, niNumber: NI });
  expect(saved.detailsCompletedAt).not.toBeNull();

  // Coming back to Your details shows the account masked.
  await page.goto("/app/details");
  await expect(page.getByText("••••6819")).toBeVisible();
  expect(await page.content()).not.toContain(ACCOUNT);

  // 6. Staff: an admin sees the details, with the NI number masked; an agent sees only that they're in.
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const p = await admin.newPage();
    await p.goto(`/artists/${act.id}`);
    const card = p.getByTestId("pay-details");
    await expect(card.getByText("Details complete")).toBeVisible();
    await expect(card.getByText(ACCOUNT)).toBeVisible();
    await expect(card.getByText("•• •• •• 26 A")).toBeVisible();
    expect(await p.content()).not.toContain(NI);
  } finally {
    await admin.close();
  }
  const agent = await browser.newContext();
  try {
    const p = await agent.newPage();
    await p.goto("/login");
    const signIn = p.getByRole("button", { name: "Sign in", exact: true });
    await hydrated(signIn);
    await p.getByLabel("Email").fill("agent@gigsaw.test");
    await p.getByLabel("Password").fill("gigsaw123");
    await signIn.click();
    await expect(p).toHaveURL(/\/dashboard/, { timeout: 20_000 });
    for (const path of [`/artists/${act.id}`, `/artists/${act.id}/edit`, "/artists?show=details", "/artists"]) {
      await p.goto(path);
      const html = await p.content();
      for (const secret of [ACCOUNT, "30-80-12", NI, "26 A", "Canal Street"]) expect(html, `${secret} on ${path}`).not.toContain(secret);
    }
    await p.goto(`/artists/${act.id}`);
    await expect(p.getByTestId("pay-details").getByText("Details complete")).toBeVisible();
  } finally {
    await agent.close();
  }
});
