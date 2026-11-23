import { randomBytes } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { createAct, db, seededAgency, someFutureDay, stamp } from "./support/data";
import { expectAfterSave, hydrated } from "./support/ui";

// A couple choose how to pay the balance on their wedding proposal (src/lib/proposal-pay.ts). The business's
// example: an evening band at £1,500, the band's fee £1,100, 20% VAT. The deposit is £480 whichever way; the
// balance is £1,100 in cash (no VAT) or £1,320 by bank transfer. They pick cash and sign.

const CASH_ADDRESS = "63 Boverton Road\nLlantwit Major\nCF61 1YA";

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

test("a couple choose to pay the balance in cash, see what that costs, and sign", async ({ page, browser }) => {
  const { agencyId } = await seededAgency();
  // Where couples bring a cash balance (Settings, Contracts and invoices).
  await db().settings.update({ where: { agencyId }, data: { cashAddress: CASH_ADDRESS } });
  const act = await createAct(stamp("E2E Cash Band"));
  const name = stamp("E2E Couple Cash");
  const contact = await db().contact.create({
    data: { agencyId, name, email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}@e2e.gigsaw.invalid`, type: "CLIENT" },
  });
  const token = randomBytes(24).toString("base64url");
  const q = await db().quote.create({
    data: {
      agencyId,
      // Letters only, so it never changes the next proposal number staff get.
      number: `PAY-${Math.random()
        .toString(36)
        .replace(/[^a-z]/g, "")
        .slice(0, 8)}`,
      contactId: contact.id,
      title: `${name}'s wedding`,
      eventType: "WEDDING",
      status: "SENT",
      sentAt: new Date(),
      sentTo: contact.email,
      token,
      tokenExpiresAt: new Date("2031-01-01T00:00:00Z"),
      terms: "1. The deposit secures your date.",
      payOptions: ["CASH", "TRANSFER"],
      lines: {
        create: [
          {
            sort: 0,
            artistId: act.id,
            description: "Evening band",
            date: someFutureDay(),
            startTime: "19:00",
            endTime: "23:00",
            place: "Home Farm",
            saleMinor: 150_000,
            costMinor: 110_000,
            vatPct: 20,
          },
        ],
      },
    },
  });

  const customer = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    const c = await customer.newPage();
    await c.goto(`/q/${token}`);
    await expect(c.getByRole("heading", { name: "How you'd like to pay" })).toBeVisible();
    // The deposit leads, including VAT, then both ways to pay the balance with what each comes to.
    await expect(c.getByTestId("customer-deposit")).toHaveText("£480.00");
    await expect(c.getByText(/^This secures your date\./)).toBeVisible();
    await expect(c.getByTestId("balance-CASH")).toHaveText("£1,100.00");
    await expect(c.getByTestId("balance-TRANSFER")).toHaveText("£1,320.00");
    await expect(c.getByText("£1,580.00 in all, with the deposit.")).toBeVisible();
    await expect(c.getByText("£1,800.00 in all, with the deposit.")).toBeVisible();
    // The business's note, with its cash address put in. Never the act's fee as a fee, never "pay the band".
    await expect(c.getByTestId("pay-note")).toContainText("delivered to the following address: 63 Boverton Road, Llantwit Major, CF61 1YA.");
    await expect(c.getByText(/Act's fee|pay the band/i)).toHaveCount(0);

    const sign = c.getByRole("button", { name: "Sign and approve" });
    await hydrated(sign);
    await expect(c.getByTestId("pay-promise")).toHaveText("I'll pay the deposit of £480.00 now, and the balance the way I choose above");
    await c.getByRole("radio", { name: "Pay the balance in cash, no VAT" }).check();
    await expect(c.getByTestId("pay-promise")).toHaveText("I'll pay the deposit of £480.00 now, and the balance of £1,100.00 in cash, with no VAT");
    await drawSignature(c);
    await expect(c.getByText("Signature added.")).toBeVisible();
    await c.getByRole("checkbox", { name: /I accept this proposal/ }).check();
    await sign.click();

    // Held until the £480 deposit is in, with their choice shown.
    await expectAfterSave(c, c.getByText("Thanks for accepting"), 15_000);
    await expect(c.getByText(/The next step is your deposit of £480\.00/)).toBeVisible();
    await expect(c.getByTestId("balance-CASH")).toHaveText("£1,100.00");
    await expect(c.getByTestId("balance-TRANSFER")).toHaveCount(0);
    await expect(c.getByText("£1,580.00 in all, with the deposit. Your choice.")).toBeVisible();
  } finally {
    await customer.close();
  }

  // The wedding is set up to match: a cash balance, VAT on the business's share only, £480 deposit.
  const accepted = await db().quote.findUniqueOrThrow({ where: { id: q.id } });
  expect(accepted).toMatchObject({ status: "ACCEPTED", payPlan: "CASH" });
  const event = await db().event.findUniqueOrThrow({ where: { id: accepted.eventId! }, include: { bookings: true } });
  expect(event.payPlan).toBe("BALANCE_CASH");
  expect(event.bookings.map((b) => ({ status: b.status, depositMinor: b.depositMinor, vatOnShare: b.vatOnShare }))).toEqual([
    { status: "HOLD", depositMinor: 48_000, vatOnShare: true },
  ]);

  // Staff see the couple's choice on the proposal.
  await page.goto(`/quotes/${q.id}`);
  const choice = page.getByTestId("staff-pay-options");
  await expect(choice).toContainText("Cash balance (no VAT)");
  await expect(choice).toContainText("Their choice");
});
