import { expect, test, type Page } from "@playwright/test";
import { createAct, someFutureDay, stamp } from "./support/data";
import { expectAfterSave, follow, hydrated, linkFromCopyField, pickFromCombobox } from "./support/ui";

/** Draw a short squiggle in the signature box, as a customer would with a mouse. */
async function drawSignature(page: Page) {
  const pad = page.getByRole("img", { name: /Signature box/ });
  await pad.scrollIntoViewIfNeeded();
  const box = await pad.boundingBox();
  if (!box) throw new Error("The signature box isn't on screen");
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 40, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(box.x + 40 + i * 18, y + (i % 2 ? -20 : 20), { steps: 3 });
  await page.mouse.up();
}

test("a lead added by hand becomes a signed proposal and a locked-in wedding", async ({ page, browser }) => {
  test.slow(); // the longest journey: lead, proposal, customer signing, wedding page
  const leadName = stamp("E2E Lead Hannah");
  const email = `${leadName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.gigsaw.invalid`;
  const act = await createAct(stamp("E2E Proposal Band"));

  // Add the lead by hand.
  await page.goto("/dashboard");
  await follow(page, page.getByRole("link", { name: "Leads & proposals" }), page.getByRole("heading", { level: 1, name: "Inbound leads" }));
  await follow(page, page.getByRole("link", { name: "Add lead" }), page.getByRole("heading", { level: 1, name: "Add a lead" }));
  const addLead = page.getByRole("button", { name: "Add lead" });
  await hydrated(addLead);
  // The quick New booking pop-up is in the page too, so look only inside this form.
  const form = page.locator("form").filter({ has: addLead });
  await form.getByLabel("Name", { exact: true }).fill(leadName);
  await form.getByRole("textbox", { name: /^Email/ }).fill(email);
  await form.getByLabel("Type of event").selectOption({ label: "Wedding" });
  await form.getByLabel(/^Date/).fill(someFutureDay());
  await form.getByLabel("Start time").fill("19:00");
  await form.getByLabel("Finish time").fill("23:30");
  await form.getByLabel("Venue or town").fill("Home Farm, near York");
  await addLead.click();

  // It's in the list of new leads: turn it into a proposal.
  await expect(page).toHaveURL(/\/enquiries$/, { timeout: 20_000 });
  const lead = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: leadName }) });
  await expect(lead).toBeVisible();
  const turn = lead.getByRole("button", { name: "Turn into a proposal" });
  await hydrated(turn);
  await turn.click();

  // The proposal editor, with a line already made from the lead's date and times: fill it in.
  await expect(page).toHaveURL(/\/quotes\/[^/]+\/edit$/, { timeout: 20_000 });
  const save = page.getByRole("button", { name: "Save proposal" });
  await hydrated(save);
  const editor = page.locator("form").filter({ has: save });
  await expect(editor.getByLabel("Date, line 1")).not.toHaveValue("");
  await pickFromCombobox(page, editor.getByLabel("Act", { exact: true }), act.name);
  await editor.getByLabel("What they do, line 1").fill("Evening band");
  await editor.getByLabel("Arrive, line 1").fill("17:30");
  await editor.getByLabel("Price, line 1").fill("1500");
  await editor.getByLabel("Act's fee, line 1").fill("1100");
  await save.click();

  // The proposal's page: get a link to send ourselves.
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/, { timeout: 20_000 });
  const proposalUrl = page.url();
  const getLink = page.getByRole("button", { name: "Get a link to send yourself" });
  await hydrated(getLink);
  await getLink.click();
  // The outcome is the link box. (The "Your link is ready" note is lost when the app's watchdog
  // reloads a page Next didn't redraw, so it isn't waited for.)
  const customerLink = await linkFromCopyField(page, "/q/");

  // The customer opens it, with no login, signs and approves.
  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const c = await customer.newPage();
    await c.goto(customerLink);
    await expect(c.getByRole("heading", { name: "Sign and approve your proposal" })).toBeVisible();
    await expect(c.getByText(act.name)).toBeVisible();
    await expect(c.getByText("Evening band")).toBeVisible();
    const sign = c.getByRole("button", { name: "Sign and approve" });
    await hydrated(sign);
    await expect(c.getByLabel("Your full name")).toHaveValue(leadName);
    await drawSignature(c);
    await expect(c.getByText("Signature added.")).toBeVisible();
    await c.getByRole("checkbox", { name: /I accept this proposal/ }).check();
    await sign.click();
    await expectAfterSave(c, c.getByText("Thank you, you're booked"), 15_000);
  } finally {
    await customer.close();
  }

  // The agency's proposal page shows it signed, and leads to the wedding.
  await page.goto(proposalUrl);
  await expect(page.getByText(`Signed and approved by ${leadName}`)).toBeVisible();
  await follow(page, page.getByRole("link", { name: "Open the event" }), page.getByText("It's locked in: no separate contract needed."));
  await expect(page).toHaveURL(/\/events\/[^/]+$/);
  // The checklist ticked "Proposal or contract signed" by itself.
  await expect(page.getByRole("button", { name: 'Mark "Proposal or contract signed" as not done' })).toBeVisible();

  // The lead has moved to Dealt with.
  await follow(page, page.getByRole("link", { name: "Leads & proposals" }), page.getByRole("heading", { level: 1, name: "Inbound leads" }));
  const dealt = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: leadName }) });
  await follow(page, page.getByRole("link", { name: /^Dealt with/ }), dealt);
  await expect(page).toHaveURL(/view=done/);
  await expect(dealt.getByText("Dealt with", { exact: true })).toBeVisible();
});
