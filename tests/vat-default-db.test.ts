import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { defaultVat } from "@/lib/money";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// "VAT on sales" (Settings, Booking fee and VAT): new bookings start with the business's VAT %,
// bookings already made keep their own, and 0 turns it off.

describe("defaultVat", () => {
  it("is the setting, or 0 when it's off or out of range", () => {
    expect(defaultVat({ defaultVatPct: 20 })).toBe(20);
    expect(defaultVat({ defaultVatPct: 0 })).toBe(0);
    expect(defaultVat({ defaultVatPct: -5 })).toBe(0);
    expect(defaultVat({ defaultVatPct: 150 })).toBe(0);
    expect(defaultVat({ defaultVatPct: Number.NaN })).toBe(0);
  });
});

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireStaff: async () => staff.user,
  requireAdmin: async () => staff.user,
}));

describeDb("VAT on sales (database)", () => {
  type Db = (typeof import("@/lib/db"))["prisma"];
  let prisma: Db;
  let agencyId = "";
  let venueId = "";
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.append(k, v);
    return f;
  };
  // A month ahead, so the date is never in the past.
  const date = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = (await import("@/lib/db")).prisma;
    const t = await createTestAgency(prisma, "vat", { defaultVatPct: 20 });
    agencyId = t.agency.id;
    staff.user = t.user;
    // Demo venue: its gigs are demo data, never messaged.
    venueId = (await prisma.venue.create({ data: { agencyId, name: "VAT Arms", demo: true } })).id;
  });

  afterAll(async () => {
    await removeTestAgency(prisma, agencyId);
  });

  const quickBook = async () => {
    const { addRotaGig } = await import("@/actions/slots");
    const res = await addRotaGig(undefined, form({ date, venueId, startTime: "19:00", endTime: "21:00", fee: "300", currency: "GBP" }));
    expect(res?.error).toBeUndefined();
    return prisma.booking.findFirstOrThrow({ where: { agencyId }, orderBy: { createdAt: "desc" } });
  };

  it("puts the default VAT on a quick booking, which has no VAT box", async () => {
    const b = await quickBook();
    expect(b.vatPct).toBe(20);
    expect(b.feeMinor).toBe(30000);
  });

  it("leaves bookings already made alone when the setting changes, and 0 turns it off", async () => {
    const before = await quickBook();
    const { saveSettings } = await import("@/actions/settings");
    expect((await saveSettings(undefined, form({ defaultVatPct: "0" })))?.ok).toBe("Saved.");
    expect((await prisma.settings.findUniqueOrThrow({ where: { agencyId } })).defaultVatPct).toBe(0);
    const after = await quickBook();
    expect(after.vatPct).toBe(0);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: before.id } })).vatPct).toBe(20);
  });

  it("only saves a VAT % between 0 and 100, and other settings pages don't touch it", async () => {
    const { saveSettings } = await import("@/actions/settings");
    expect((await saveSettings(undefined, form({ defaultVatPct: "120" })))?.error).toMatch(/between 0 and 100/);
    expect((await saveSettings(undefined, form({ defaultVatPct: "17.5" })))?.ok).toBe("Saved.");
    await saveSettings(undefined, form({ bookingFee: "25" }));
    expect((await prisma.settings.findUniqueOrThrow({ where: { agencyId } })).defaultVatPct).toBe(17.5);
    await saveSettings(undefined, form({ defaultVatPct: "20" }));
  });

  it("gives copies the original's VAT, or the default when the original has none", async () => {
    const { copyBooking } = await import("@/actions/bookings");
    const original = await prisma.booking.findFirstOrThrow({ where: { agencyId, vatPct: 0 } });
    const later = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const res = await copyBooking(original.id, [later], "PENDING", false);
    expect(res.ok).toBe(true);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: res.ids[0] } })).vatPct).toBe(20);

    await prisma.booking.update({ where: { id: original.id }, data: { vatPct: 5 } });
    const res2 = await copyBooking(original.id, [later], "PENDING", false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: res2.ids[0] } })).vatPct).toBe(5);
  });

  it("puts the default VAT on a gig booked from a weekly slot", async () => {
    const slot = await prisma.venueSlot.create({
      data: { agencyId, venueId, weekday: 3, arriveTime: "18:30", startTime: "19:00", endTime: "21:00", feeMinor: 15000 },
    });
    const { bookRegulars } = await import("@/actions/slots");
    const { weekStartOf } = await import("@/lib/rota");
    const res = await bookRegulars(undefined, form({ weekStart: weekStartOf(date), weeks: "1", mode: "pending" }));
    expect(res?.ok).toMatch(/Added 1 booking/);
    const b = await prisma.booking.findFirstOrThrow({ where: { slotId: slot.id } });
    expect(b.vatPct).toBe(20);
  });
});
