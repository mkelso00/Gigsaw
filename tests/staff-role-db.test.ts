import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Making someone an admin or an agent (src/lib/staff-role.ts): Settings, Internal users, and the Owner area.
// A business always keeps an admin, and people in other businesses can't be touched.

const staff = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => {}, notFound: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  requireAdmin: async () => staff.user,
  requireStaff: async () => staff.user,
  requireOwner: async () => staff.user,
}));

type Db = typeof import("@/lib/db");

describeDb("making someone an admin or an agent (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let otherAgencyId = "";
  let adminId = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "staffrole");
    agencyId = t.agency.id;
    adminId = t.user.id;
    staff.user = t.user;
    otherAgencyId = (await createTestAgency(prisma, "staffrole2")).agency.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await removeTestAgency(prisma, otherAgencyId);
    await prisma.$disconnect();
  });

  const person = (agency: string, role = "AGENT") =>
    prisma.user.create({
      data: {
        email: `p-${Date.now()}-${Math.random().toString(36).slice(2)}@staffrole.gigsaw.invalid`,
        name: "Tom Sutch",
        passwordHash: "x",
        role,
        agencyId: agency,
      },
    });
  const roleOf = async (id: string) => (await prisma.user.findUniqueOrThrow({ where: { id } })).role;

  it("an admin makes an agent an admin, and back again", async () => {
    const { changeStaffRole } = await import("@/actions/settings");
    const tom = await person(agencyId);
    await changeStaffRole(tom.id, "ADMIN");
    expect(await roleOf(tom.id)).toBe("ADMIN");
    expect(await prisma.activity.count({ where: { agencyId, entityId: tom.id, action: "made an admin" } })).toBe(1);
    await changeStaffRole(tom.id, "AGENT");
    expect(await roleOf(tom.id)).toBe("AGENT");
  });

  it("won't change your own role, or someone in another business", async () => {
    const { changeStaffRole } = await import("@/actions/settings");
    await changeStaffRole(adminId, "AGENT");
    expect(await roleOf(adminId)).toBe("ADMIN");
    const outsider = await person(otherAgencyId);
    await changeStaffRole(outsider.id, "ADMIN");
    expect(await roleOf(outsider.id)).toBe("AGENT");
  });

  it("the Owner area can make someone an admin, but never leaves a business with no admin", async () => {
    const { setAgencyUserRole } = await import("@/actions/owner");
    const { setStaffRole } = await import("@/lib/staff-role");
    const tom = await person(otherAgencyId);
    expect(await setAgencyUserRole(tom.id, "ADMIN", {})).toMatchObject({ ok: expect.stringContaining("can open Settings") });
    expect(await roleOf(tom.id)).toBe("ADMIN");

    // Make every other admin in that business an agent, then Tom is the last one.
    const others = await prisma.user.findMany({ where: { agencyId: otherAgencyId, role: "ADMIN", id: { not: tom.id } } });
    for (const o of others) expect(await setStaffRole(otherAgencyId, o.id, "AGENT")).toMatchObject({ name: o.name });
    expect(await setAgencyUserRole(tom.id, "AGENT", {})).toMatchObject({ error: expect.stringContaining("only admin") });
    expect(await roleOf(tom.id)).toBe("ADMIN");
  });
});
