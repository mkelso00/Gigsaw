import { expect, test, type Page } from "@playwright/test";
import { createAct, createVenue, someFutureDay, stamp } from "./support/data";
import { hydrated, pickFromCombobox, signIn } from "./support/ui";

// "Only book acts who've signed up to Gigsaw" (src/lib/book-signed-up.ts), on in the seeded business. Staff who
// aren't admins can't book an act who hasn't signed up; an admin is asked first, and can approve the act on its
// page, after which anyone can book it.

/** The full New booking form, filled in for this act and venue, and submitted. */
async function tryToBook(page: Page, actName: string, venueName: string, eventName: string) {
  await page.goto("/bookings/new");
  const create = page.getByRole("button", { name: "Create booking" });
  await hydrated(create);
  const form = page.locator("form").filter({ has: create });
  const act = form.getByLabel("Act", { exact: true });
  await hydrated(act);
  await act.click();
  await act.fill(actName);
  return {
    form,
    act,
    create,
    submit: async () => {
      await page.getByRole("option", { name: actName }).click();
      await expect(act).toHaveValue(actName);
      await pickFromCombobox(page, form.getByLabel("Venue", { exact: true }), venueName);
      await form.getByLabel("Event name").fill(eventName);
      await form.getByLabel("Date", { exact: true }).fill(someFutureDay());
      await form.getByLabel("Start", { exact: true }).fill("20:00");
      await form.getByLabel("Finish", { exact: true }).fill("22:00");
      await create.click();
    },
  };
}

test("staff are refused an act who hasn't signed up, until an admin approves them", async ({ page, browser }) => {
  const act = await createAct(stamp("E2E Unsigned Singer"), { approved: false });
  const venue = await createVenue(stamp("E2E Unsigned Club"));
  const eventName = stamp("E2E Unsigned Night");
  const refusal = `${act.name} hasn't signed up to Gigsaw yet, so they can't be booked. Send them their sign-up link (Acts → ${act.name}), or ask an admin to approve them.`;

  const agent = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const p = await agent.newPage();
    await signIn(p, "agent@gigsaw.test", "gigsaw123");
    await expect(p).toHaveURL(/\/dashboard/, { timeout: 20_000 });

    // 1. The picker says so, and saving is refused with what to do.
    const first = await tryToBook(p, act.name, venue.name, eventName);
    await expect(p.getByRole("option", { name: act.name })).toContainText("Not signed up");
    await first.submit();
    await expect(p.getByRole("alert").filter({ hasText: refusal })).toBeVisible({ timeout: 15_000 });
    await expect(p).toHaveURL(/\/bookings\/new/);

    // The act's page offers the sign-up link, but approving is for admins.
    await p.goto(`/artists/${act.id}`);
    const card = p.getByTestId("book-signup");
    await expect(card).toContainText(`${act.name} hasn't signed up to Gigsaw yet.`);
    await expect(card.getByRole("button", { name: "Send sign-up link" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Approve to book before signing up" })).toHaveCount(0);

    // 2. An admin is asked before booking them, and approves them on their page instead.
    const admin = await tryToBook(page, act.name, venue.name, stamp("E2E Admin Try"));
    await admin.submit();
    const ask = page.getByRole("alert").filter({ hasText: `${act.name} hasn't signed up to Gigsaw yet` });
    await expect(ask).toBeVisible({ timeout: 15_000 });
    await expect(ask.getByRole("button", { name: "Book anyway" })).toBeVisible();
    await ask.getByRole("button", { name: "Go back" }).click();

    await page.goto(`/artists/${act.id}`);
    const approve = page.getByTestId("book-signup").getByRole("button", { name: "Approve to book before signing up" });
    await hydrated(approve);
    await approve.click();
    await expect(page.getByTestId("book-signup")).toContainText("Approved to book before signing up by Alex Morgan", { timeout: 15_000 });
    await expect(page.getByTestId("book-signup").getByRole("button", { name: "Take back approval" })).toBeVisible();
    await page.goto(`/artists?q=${encodeURIComponent(act.name)}`);
    await expect(page.getByText("Approved to book").first()).toBeVisible();

    // 3. Now staff can book them.
    const again = await tryToBook(p, act.name, venue.name, eventName);
    await expect(p.getByRole("option", { name: act.name })).toContainText("Approved");
    await again.submit();
    await expect(p).toHaveURL(/\/bookings\/[^/]+$/, { timeout: 20_000 });
    await expect(p.getByRole("heading", { level: 1 })).toContainText(act.name);
    await expect(p.getByText(eventName)).toBeVisible();
  } finally {
    await agent.close();
  }
});
