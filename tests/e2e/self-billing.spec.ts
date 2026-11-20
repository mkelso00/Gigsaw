import { expect, test } from "@playwright/test";
import { ADMIN_STATE } from "./support/env";
import { createAct, createMemberLogin, db, stamp } from "./support/data";
import { hydrated, signIn } from "./support/ui";

// The self-billing agreement (src/lib/self-billing.ts): an act can't save their pay details in the app without ticking
// it, the time and the wording they agreed to are kept, staff see it on the act's page, and a year later the app asks
// them to agree again.

test.use({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test("an act ticks the self-billing agreement when saving their details, and is asked again a year later", async ({ page, browser }) => {
  const tag = stamp("SB").replace(/\W/g, "");
  const act = await createAct(stamp("E2E Self Billing Solo"));
  const solo = await createMemberLogin(act.id, "Sol", `Agree${tag}`);

  await signIn(page, solo.email, solo.password);
  await expect(page).toHaveURL(/\/app\/details$/, { timeout: 20_000 });
  const save = page.getByRole("button", { name: "Save and see my bookings" });
  await hydrated(save);
  await page.getByLabel("Name on the account").fill(`Sol Agree${tag}`);
  await page.getByLabel("Sort code").fill("308012");
  await page.getByLabel("Account number").fill("55667788");
  await page.getByLabel("Postal address").fill("3 Tick Lane\nLeeds");

  // The agreement, with the business's name, has to be ticked: without it the form isn't sent.
  const tick = page.getByRole("checkbox", { name: /will make out invoices for my gigs on my behalf \(self-billing\)/ });
  await expect(tick).toBeVisible();
  await expect(page.getByText(/I won't issue my own invoices for these gigs, and I'll tell .+ if my VAT registration changes\./)).toBeVisible();
  await save.click();
  expect(await tick.evaluate((el) => (el as HTMLInputElement).validity.valueMissing)).toBe(true);
  await expect(page).toHaveURL(/\/app\/details$/);
  expect(await db().person.findUniqueOrThrow({ where: { id: solo.person.id } })).toMatchObject({ detailsCompletedAt: null, selfBillingAgreedAt: null });

  const before = Date.now();
  await tick.check();
  await save.click();
  await expect(page).toHaveURL(/\/app$/, { timeout: 20_000 });
  const saved = await db().person.findUniqueOrThrow({ where: { id: solo.person.id } });
  expect(saved.selfBillingAgreedAt!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
  expect(saved.selfBillingAgreedText).toMatch(/^.+ will make out invoices for my gigs on my behalf \(self-billing\)\. I won't issue my own invoices/);
  await expect(page.getByTestId("self-billing-prompt")).toHaveCount(0);

  // Back on Your details: when they agreed, and no box to tick.
  await page.goto("/app/details");
  await expect(page.getByTestId("self-billing-agreed")).toContainText("You agreed on");
  await expect(page.getByRole("checkbox", { name: /self-billing/ })).toHaveCount(0);

  // Staff see it on the act's page, with what was agreed.
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const p = await admin.newPage();
    await p.goto(`/artists/${act.id}`);
    const status = p.getByTestId("pay-details").getByTestId("self-billing-status");
    await expect(status.getByText("Self-billing agreed")).toBeVisible();
    await status.getByText("What they agreed to").click();
    await expect(status.getByText(saved.selfBillingAgreedText)).toBeVisible();
  } finally {
    await admin.close();
  }

  // A year and more later, the app asks them to agree again.
  await db().person.update({ where: { id: solo.person.id }, data: { selfBillingAgreedAt: new Date(Date.now() - 400 * 86_400_000) } });
  await page.goto("/app");
  const prompt = page.getByTestId("self-billing-prompt");
  await expect(prompt).toContainText("Please confirm self-billing again");
  await prompt.click();
  await expect(page).toHaveURL(/\/app\/details#self-billing$/);
  await expect(page.getByText("It's been 12 months since you agreed to this.")).toBeVisible();
  const again = page.getByRole("button", { name: "Save changes" });
  await hydrated(again);
  await page.getByRole("checkbox", { name: /self-billing/ }).check();
  await again.click();
  await expect(page.getByText("Saved. Thanks, your details are up to date.")).toBeVisible({ timeout: 20_000 });
  const renewed = await db().person.findUniqueOrThrow({ where: { id: solo.person.id } });
  expect(renewed.selfBillingAgreedAt!.getTime()).toBeGreaterThanOrEqual(before - 5_000);
});
