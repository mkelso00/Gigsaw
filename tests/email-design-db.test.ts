import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Settings → Email design saved, the logo served, and a real email picking the design up.
// Database tests: TEST_DATABASE_URL only.

const state = vi.hoisted(() => ({ user: null as unknown, later: [] as Promise<unknown>[], html: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const signedIn = async () => state.user;
  return { ...real, requireUser: signedIn, requireStaff: signedIn, requireAdmin: signedIn };
});
vi.mock("@/lib/message-format", async (orig) => {
  const real = await orig<typeof import("@/lib/message-format")>();
  return {
    ...real,
    renderEmail: (c: Parameters<typeof real.renderEmail>[0]) => {
      const out = real.renderEmail(c);
      state.html.push(out.html);
      return out;
    },
  };
});

type Db = typeof import("@/lib/db");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
const form = (fields: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
};

describeDb("email design (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "design", { agencyName: "Design Test Music", agencyEmail: "office@design.gigsaw.invalid" });
    agencyId = t.agency.id;
    state.user = { ...t.admin, agencyId, role: "ADMIN", name: "Admin", email: t.admin.email };
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const base = { header: "#15120f", accent: "#c9a25b", website: "designtest.example", phone: "07700 900123", buttonLabel: "See our acts", steps: "One\nTwo" };

  it("saves the colours, footer and steps, and a real PNG logo", async () => {
    const { saveEmailDesign } = await import("@/actions/email-design");
    const res = await saveEmailDesign(undefined, form({ ...base, logo: new File([PNG], "logo.png", { type: "image/png" }) }));
    expect(res).toEqual({ ok: "Saved. Every email you send now uses this look." });
    const s = await prisma.settings.findUniqueOrThrow({ where: { agencyId } });
    expect(s.emailDesign).toMatchObject({ header: "#15120f", accent: "#c9a25b", website: "https://designtest.example", steps: ["One", "Two"] });
    const logo = await prisma.brandLogo.findUniqueOrThrow({ where: { agencyId } });
    expect(logo.mime).toBe("image/png");

    // Served to email apps with no login.
    const { GET } = await import("@/app/brand/[agencyId]/logo/route");
    const r = await GET(new Request("http://x"), { params: Promise.resolve({ agencyId }) });
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await r.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("turns away a file that isn't really an image, a bad colour or a bad website", async () => {
    const { saveEmailDesign } = await import("@/actions/email-design");
    const fake = new File(["<svg onload=alert(1)>"], "logo.png", { type: "image/png" });
    expect(await saveEmailDesign(undefined, form({ ...base, logo: fake }))).toEqual({
      error: "The logo must be a PNG, JPG or GIF image (email apps don't all show other kinds)",
    });
    expect(await saveEmailDesign(undefined, form({ ...base, header: "red" }))).toEqual({ error: "Choose a header colour and an accent colour" });
    expect(await saveEmailDesign(undefined, form({ ...base, website: "not a website" }))).toEqual({
      error: "Check the website address, e.g. yourbusiness.co.uk",
    });
    // The good logo from before is still there.
    expect(await prisma.brandLogo.count({ where: { agencyId } })).toBe(1);
  });

  it("puts the design on the business's emails, with the logo link", async () => {
    const { sendEmail } = await import("@/lib/messaging");
    state.html = [];
    await sendEmail({ kind: "ENQUIRY", agencyId, to: "customer@design.gigsaw.invalid", subject: "Hi", email: { brand: "Design Test Music", title: "Thanks" } });
    expect(state.html[0]).toContain(`/brand/${agencyId}/logo?v=`);
    expect(state.html[0]).toContain("background:#15120f");
    expect(state.html[0]).toContain("07700 900123");
  });

  it("removes the logo when asked", async () => {
    const { saveEmailDesign } = await import("@/actions/email-design");
    await saveEmailDesign(undefined, form({ ...base, logoRemove: "on" }));
    expect(await prisma.brandLogo.count({ where: { agencyId } })).toBe(0);
    const { GET } = await import("@/app/brand/[agencyId]/logo/route");
    expect((await GET(new Request("http://x"), { params: Promise.resolve({ agencyId }) })).status).toBe(404);
  });
});
