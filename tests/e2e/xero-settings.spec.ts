import { expect, test } from "@playwright/test";
import { db, seededAgency } from "./support/data";
import { baseURL } from "./support/env";
import { hydrated } from "./support/ui";

// Settings, Xero. The test server runs without XERO_CLIENT_ID and XERO_CLIENT_SECRET, as a new site does, so the
// page explains the setup instead of offering Connect. The tests share the seeded business's one Xero connection,
// so they run one after another.
test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const { agencyId } = await seededAgency();
  await db().xeroConnection.deleteMany({ where: { agencyId } });
});

test("Settings, Xero: without Xero's app it explains the setup and the redirect URL, and Connect isn't offered", async ({ page }) => {
  await page.goto("/settings/general");
  await page.getByRole("link", { name: "Xero", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/xero$/);
  await expect(page.getByRole("heading", { name: "Xero", exact: true })).toBeVisible();
  await expect(page.getByText("Xero isn't set up yet")).toBeVisible();
  await expect(page.locator(`input[value="${baseURL}/api/xero/callback"]`)).toBeVisible();
  await expect(page.getByText("XERO_CLIENT_SECRET").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Xero" })).toHaveCount(0);
  // The invoice settings only show once Xero can be used.
  await expect(page.locator('input[name="salesAccountCode"]')).toHaveCount(0);

  // Going to the connect address anyway comes straight back with a message.
  await page.goto("/api/xero/connect");
  await expect(page).toHaveURL(/\/settings\/xero\?xero=off$/);
  await expect(page.getByRole("alert").filter({ hasText: "Xero isn't set up on this site yet" })).toBeVisible();
});

test("Settings, Xero: a connection left from before shows the organisation and the missing settings, and can be disconnected", async ({ page }) => {
  const { agencyId, adminId } = await seededAgency();
  await db().xeroConnection.create({
    data: {
      agencyId,
      tenantId: "11111111-1111-4111-8111-111111111111",
      tenantName: "Northern Lights Ltd",
      // Never opened: without Xero's app Gigsaw doesn't try to revoke it.
      refreshTokenEnc: "v1.not.a.token",
      connectedById: adminId,
      connectedAt: new Date(),
      salesAccountCode: "210",
    },
  });
  await page.goto("/settings/xero");
  await expect(page.getByText("Northern Lights Ltd")).toBeVisible();
  await expect(page.getByText("Xero's settings are missing")).toBeVisible();
  await expect(page.getByText("Connected by", { exact: false })).toBeVisible();
  // Settings can still be changed while connected.
  await expect(page.locator('input[name="salesAccountCode"]')).toHaveValue("210");

  const button = page.getByRole("button", { name: "Disconnect Xero" });
  await hydrated(button);
  page.once("dialog", (d) => void d.accept());
  await button.click();
  await expect(page).toHaveURL(/\/settings\/xero\?xero=disconnected$/, { timeout: 15_000 });
  await expect(page.getByText("Xero is disconnected.")).toBeVisible();
  await expect(page.getByText("Xero isn't set up yet")).toBeVisible();
  const conn = await db().xeroConnection.findUniqueOrThrow({ where: { agencyId } });
  expect(conn).toMatchObject({ tenantId: "", refreshTokenEnc: "", salesAccountCode: "210" });
});
