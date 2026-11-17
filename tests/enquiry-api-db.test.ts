import { NextRequest } from "next/server";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// A business's own enquiry form on another website (e.g. a Shopify section) posting to
// /api/enquire/<slug>. Database tests: TEST_DATABASE_URL only.

const state = vi.hoisted(() => ({ later: [] as Promise<unknown>[] }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/server", async (orig) => {
  const real = await orig<typeof import("next/server")>();
  return { ...real, after: (fn: () => Promise<unknown>) => state.later.push(fn()) };
});

type Db = typeof import("@/lib/db");
let ipN = 0;

describeDb("enquiries from a form on another website (database)", () => {
  let prisma: Db["prisma"];
  let route: typeof import("@/app/api/enquire/[slug]/route");
  let agencyId = "";
  let slug = "";
  let actId = "";

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    route = await import("@/app/api/enquire/[slug]/route");
    slug = `api-test-${Date.now().toString(36)}`;
    const t = await createTestAgency(prisma, "enqapi", { enquirySlug: slug, enquiryOn: true, agencyName: "API Test Music" });
    agencyId = t.agency.id;
    actId = (await prisma.artist.create({ data: { agencyId, name: "No Sutch Thing" } })).id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await Promise.allSettled(state.later);
    await removeTestAgency(prisma, agencyId);
    await prisma.$disconnect();
  });

  const ctx = (s = slug) => ({ params: Promise.resolve({ slug: s }) });
  const oldStamp = async () => {
    const { formStamp } = await import("@/lib/enquiries");
    const { enquirySecret } = await import("@/lib/enquiry-server");
    return formStamp(Date.now() - 10_000, await enquirySecret());
  };
  const post = (body: unknown, s = slug) =>
    route.POST(
      new NextRequest(`http://localhost/api/enquire/${s}`, {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
        headers: { "content-type": "application/json", origin: "https://shop.example", "x-forwarded-for": `10.77.0.${++ipN}` },
      }),
      ctx(s),
    );
  const nextYear = `${new Date().getUTCFullYear() + 1}-06-20`;

  it("gives a time stamp to send back, and lets any site call it", async () => {
    const res = await route.GET(new NextRequest(`http://localhost/api/enquire/${slug}`, { headers: { origin: "https://shop.example" } }), ctx());
    expect(res.headers.get("access-control-allow-origin")).toBe("https://shop.example");
    const body = await res.json();
    expect(body.on).toBe(true);
    expect(body.t).toMatch(/^\d+\.[\w-]{22}$/);
  });

  it("takes a wedding enquiry: links the act by name and keeps the form's own questions", async () => {
    const email = `couple-${Date.now()}@api.gigsaw.invalid`;
    const res = await post({
      eventType: "wedding",
      acts: ["no sutch thing", "Some Other Band"],
      name: "Hannah and Sam",
      email,
      phone: "07700 900123",
      date: nextYear,
      venue: "Hollins Hall, Leeds",
      budget: "£2,000 to £3,000",
      message: "First dance: Golden Hour",
      details: { "Looking for": ["Wedding band", "DJ and sax"], "How did you find us": "Instagram", "Marketing emails": "Yes" },
      source: "https://shop.example/pages/check-availability",
      t: await oldStamp(),
      company_site: "",
    });
    expect(await res.json()).toEqual({ ok: true });
    expect(res.status).toBe(200);
    const e = await prisma.enquiry.findFirstOrThrow({ where: { agencyId, email } });
    expect(e).toMatchObject({ name: "Hannah and Sam", eventType: "WEDDING", date: nextYear, venue: "Hollins Hall, Leeds", budget: "£2,000 to £3,000" });
    expect(e.acts).toEqual([{ id: actId, name: "No Sutch Thing" }]);
    expect(e.message).toContain("Act asked about: Some Other Band");
    expect(e.message).toContain("First dance: Golden Hour");
    expect(e.message).toContain("Looking for: Wedding band, DJ and sax");
    expect(e.message).toContain("How did you find us: Instagram");
    expect(e.source).toBe("https://shop.example/pages/check-availability");
    // A wedding with a date makes a wedding.
    expect(e.eventId).toBeTruthy();
  });

  it("files a venue or event enquiry as Something else, with a booking", async () => {
    const email = `venue-${Date.now()}@api.gigsaw.invalid`;
    const res = await post({ eventType: "venue", name: "The Crown", email, date: nextYear, venue: "The Crown, Bristol", t: await oldStamp() });
    expect(res.status).toBe(200);
    const e = await prisma.enquiry.findFirstOrThrow({ where: { agencyId, email } });
    expect(e.eventType).toBe("OTHER");
    expect(e.bookingId).toBeTruthy();
  });

  it("quietly drops a bot (hidden box filled in, or no stamp)", async () => {
    const email = `bot-${Date.now()}@api.gigsaw.invalid`;
    expect(await (await post({ eventType: "WEDDING", name: "Bot", email, date: nextYear, t: await oldStamp(), company_site: "x" })).json()).toEqual({
      ok: true,
    });
    expect(await (await post({ eventType: "WEDDING", name: "Bot", email, date: nextYear })).json()).toEqual({ ok: true });
    expect(await prisma.enquiry.count({ where: { agencyId, email } })).toBe(0);
  });

  it("says what's wrong, so the form can show it", async () => {
    const bad = await post({ eventType: "WEDDING", name: "Hannah", email: "not-an-email", date: nextYear, t: await oldStamp() });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "Please check the email address", code: "invalid" });
    expect((await post("{not json")).status).toBe(400);
    const off = await post({ name: "x" }, "no-such-form-here");
    expect(off.status).toBe(403);
    expect((await off.json()).code).toBe("off");
  });
});
