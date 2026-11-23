import { expect, test, type Locator, type Page } from "@playwright/test";
import { db, seededAgency, someFutureDay, stamp } from "./support/data";
import { hydrated, linkFromCopyField } from "./support/ui";

// Contract types: two made in Settings, a proposal switched between them in the editor (the Terms box
// takes each one's wording), and the customer's page showing the one chosen. The types are made for no
// event type and aren't the default, so other tests' proposals and contracts never pick them, and they're
// deleted again at the end.

/** Add a contract type in Settings and save its name and wording. Returns its card. */
async function addContractType(page: Page, name: string, terms: string): Promise<Locator> {
  const cards = page.getByTestId("contract-type");
  const before = await cards.count();
  const add = page.getByRole("button", { name: before ? "Add a contract type" : "Add your first contract" });
  await hydrated(add);
  await add.click();
  await expect(cards).toHaveCount(before + 1, { timeout: 15_000 });
  const card = cards.nth(before);
  const save = card.getByRole("button", { name: "Save", exact: true });
  await hydrated(save);
  await card.getByLabel("Name", { exact: true }).fill(name);
  await card.getByLabel("Terms").fill(terms);
  await save.click();
  // Once saved, the card is found by its name.
  const saved = cards.filter({ has: page.locator(`input[name="name"][value="${name}"]`) });
  await expect(saved).toHaveCount(1, { timeout: 15_000 });
  await expect(saved.getByLabel("Terms")).toHaveValue(terms);
  return saved;
}

/** Delete a contract type from its card: it asks first (`asks` is the question), saying sent proposals keep their wording. */
async function deleteContractType(page: Page, name: string, asks: string) {
  const card = page.getByTestId("contract-type").filter({ has: page.locator(`input[name="name"][value="${name}"]`) });
  const del = card.getByRole("button", { name: "Delete this contract type" });
  await hydrated(del);
  await del.click();
  await expect(card.getByText(asks)).toBeVisible();
  await expect(card.getByText(/keep their own copy of the wording/)).toBeVisible();
  await card.getByRole("button", { name: "Delete it" }).click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });
}

test("contract types made in Settings fill a proposal's terms, and the customer reads the one chosen", async ({ page, browser }) => {
  test.slow();
  const tag = stamp("E2E");
  const first = `Festival contract ${tag}`;
  const second = `Corporate hire ${tag}`;
  const firstTerms = `1. Festival wording ${tag}.\n2. Stage times are set by the festival.`;
  const secondTerms = `1. Corporate wording ${tag}.\n2. Invoices are paid within 30 days.`;
  const { agencyId } = await seededAgency();
  const customer = await db().contact.create({
    data: {
      agencyId,
      type: "CLIENT",
      name: stamp("E2E Contract Client"),
      company: "Private client",
      email: `${tag.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}@e2e.gigsaw.invalid`,
    },
  });

  // Two contract types in Settings, Contracts and invoices.
  await page.goto("/settings/documents");
  await expect(page.getByRole("heading", { name: "Contract types" })).toBeVisible();
  await addContractType(page, first, firstTerms);
  await addContractType(page, second, secondTerms);

  // A proposal for the customer, from their page.
  await page.goto(`/contacts/${customer.id}`);
  const make = page.getByRole("button", { name: "Make a proposal" });
  await hydrated(make);
  await make.click();
  await expect(page).toHaveURL(/\/quotes\/[^/]+\/edit$/, { timeout: 20_000 });
  const save = page.getByRole("button", { name: "Save proposal" });
  await hydrated(save);
  const editor = page.locator("form").filter({ has: save });
  // A select's name includes the option shown, e.g. "Contract Wedding contract".
  const contract = editor.getByRole("combobox", { name: /^Contract\b/ });
  const terms = editor.getByLabel("Terms");

  // A new proposal is a wedding until changed, so it starts with the seeded Wedding contract.
  await expect(contract.locator("option:checked")).toHaveText("Wedding contract");
  await expect(terms).toHaveValue(/Your date is secured/);

  // Picking a contract puts its wording in the Terms box; picking another replaces it.
  await contract.selectOption({ label: first });
  await expect(terms).toHaveValue(firstTerms);
  await contract.selectOption({ label: second });
  await expect(terms).toHaveValue(secondTerms);

  // A line to send: a date, a start time, a price and (a wedding's deposit and balance come from it) the act's fee.
  await editor.getByRole("button", { name: "+ Add a line" }).click();
  await editor.getByLabel("Date, line 1").fill(someFutureDay());
  await editor.getByLabel("Start, line 1").fill("19:00");
  await editor.getByLabel("Price, line 1").fill("800");
  await editor.getByLabel("Act's fee, line 1").fill("500");
  // Bank transfer balance only, so it doesn't depend on an address for cash payments in Settings.
  await editor.getByRole("checkbox", { name: /Offer: Cash balance/ }).uncheck();
  await save.click();

  // The proposal's page shows the wording and where it came from; get the customer's link.
  await expect(page).toHaveURL(/\/quotes\/[^/]+$/, { timeout: 20_000 });
  await expect(page.getByText(`from the ${second}`)).toBeVisible();
  const getLink = page.getByRole("button", { name: "Get a link to send yourself" });
  await hydrated(getLink);
  await getLink.click();
  const customerLink = await linkFromCopyField(page, "/q/");

  // The customer reads the chosen contract's terms, and not the other one's.
  const visitor = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const c = await visitor.newPage();
    await c.goto(customerLink);
    await expect(c.getByTestId("proposal-terms")).toContainText(`Corporate wording ${tag}.`);
    await expect(c.getByTestId("proposal-terms")).not.toContainText("Festival wording");
  } finally {
    await visitor.close();
  }

  // Back in Settings: deleting asks first (and says so when a type is in use), and the sent proposal keeps its terms.
  await page.goto("/settings/documents");
  // The sent proposal went out with the second one; nothing uses the first.
  await deleteContractType(page, second, "This contract type is in use. Delete it anyway?");
  await deleteContractType(page, first, "Delete this contract type?");
  const quote = await db().quote.findFirstOrThrow({ where: { agencyId, contactId: customer.id } });
  expect(quote).toMatchObject({ status: "VIEWED", terms: secondTerms, contractTemplateId: null });
});
