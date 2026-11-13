import { expect, test } from "@playwright/test";
import { createWedding, db, seededAgency, stamp } from "./support/data";
import { hydrated } from "./support/ui";

// The business's own itinerary fields (Settings, Weddings and events): they appear on the wedding
// page's plan and on the couple's planner link, and what's typed is kept.
test("the business's own plan fields can be filled in on a wedding", async ({ page, browser }) => {
  const { agencyId } = await seededAgency();
  // Added straight to the settings, alongside anything already there, so other tests are unaffected.
  const settings = await db().settings.findUniqueOrThrow({ where: { agencyId }, select: { planExtraFields: true } });
  const fields = Array.isArray(settings.planExtraFields) ? (settings.planExtraFields as { id: string; label: string }[]) : [];
  if (!fields.some((f) => f.id === "e2eceremony")) {
    await db().settings.update({ where: { agencyId }, data: { planExtraFields: [...fields, { id: "e2eceremony", label: "Ceremony time" }] } });
  }
  const wedding = await createWedding(stamp("E2E Wedding Extras"));

  await page.goto(`/events/${wedding.id}`);
  const box = page.getByLabel("Ceremony time", { exact: true });
  await expect(box).toBeVisible();
  await hydrated(box);
  await box.fill("1pm in the orangery");
  await page.getByRole("button", { name: "Save plan" }).click();
  await expect
    .poll(async () => (await db().event.findUniqueOrThrow({ where: { id: wedding.id }, select: { planExtras: true } })).planExtras, { timeout: 15_000 })
    .toEqual({ e2eceremony: "1pm in the orangery" });

  // The couple's planner shows the same box with what's been filled in.
  // A new wedding gets its planner link when the first email goes; give this one a link now.
  const token = `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`.padEnd(24, "x");
  await db().event.update({ where: { id: wedding.id }, data: { plannerToken: token } });
  const couple = await browser.newPage();
  await couple.goto(`/w/${token}`);
  // Not exact: a filled-in box inside its label adds its text to the label.
  await expect(couple.getByLabel("Ceremony time")).toHaveValue("1pm in the orangery");
  await couple.close();
});
