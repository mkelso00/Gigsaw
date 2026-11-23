import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Contract types (database): the migration that turns the old single wording into a "Standard contract",
// new proposals taking the right contract (the client's own, then by event type, then the default),
// choosing a booking's or event's contract, and deleting a type leaving sent proposals as they were.
// Database tests: TEST_DATABASE_URL only.

const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const signedIn = async () => state.user;
  return { ...real, requireUser: signedIn, requireStaff: signedIn, requireAdmin: signedIn };
});
vi.mock("@/lib/messaging", async (orig) => {
  const real = await orig<typeof import("@/lib/messaging")>();
  return { ...real, sendEmail: async () => "SENT", sendSms: async () => "SENT", sendPush: async () => 0 };
});

type Db = typeof import("@/lib/db");
const form = (fields: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

describeDb("contract types (database)", () => {
  let prisma: Db["prisma"];
  let agencyId = "";
  let user: { id: string; agencyId: string; email: string };
  const others: string[] = [];
  let n = 0;
  const ids = { wedding: "", corporate: "", small: "", standard: "" };

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    const t = await createTestAgency(prisma, "ctypes", { agencyName: "Suave Test Music", defaultTimezone: "Europe/London" });
    agencyId = t.agency.id;
    user = { id: t.admin.id, agencyId, email: t.admin.email };
    state.user = { ...t.user, role: "ADMIN" };
    const { addContractTemplate } = await import("@/lib/contract-templates-server");
    // The first one added is the default, until another is made the default.
    const standard = await addContractTemplate(agencyId, { name: "Standard contract", terms: "Standard terms." });
    expect(standard.isDefault).toBe(true);
    const wedding = await addContractTemplate(agencyId, { name: "Wedding contract", terms: "Wedding terms.", eventTypes: ["WEDDING"] });
    const corporate = await addContractTemplate(agencyId, { name: "Corporate contract", terms: "Corporate terms.", eventTypes: ["CORPORATE"] });
    const small = await addContractTemplate(agencyId, {
      name: "Musician hire, small events",
      terms: "Small event terms.",
      eventTypes: ["PRIVATE_PARTY", "OTHER"],
    });
    Object.assign(ids, { wedding: wedding.id, corporate: corporate.id, small: small.id, standard: standard.id });
  });

  afterAll(async () => {
    if (!prisma) return;
    await removeTestAgency(prisma, agencyId);
    for (const id of others) await removeTestAgency(prisma, id);
    await prisma.$disconnect();
  });

  const stamp = () => `${++n}-${Date.now().toString(36)}`;
  const client = (name: string, contractTemplateId: string | null = null) =>
    prisma.contact.create({ data: { agencyId, name, company: name, type: "COMPANY", email: `c-${stamp()}@ctypes.gigsaw.invalid`, contractTemplateId } });
  const enquiry = (contactId: string, eventType: string) =>
    prisma.enquiry.create({
      data: {
        agencyId,
        name: "Jo Bloggs",
        email: `e-${stamp()}@ctypes.gigsaw.invalid`,
        eventType,
        date: "2030-06-01",
        startTime: "19:00",
        contactId,
        channel: "EMAIL",
      },
    });
  const proposalFor = async (contactId: string, eventType: string) => {
    const { createDraftProposal } = await import("@/lib/proposal-server");
    const e = await enquiry(contactId, eventType);
    return createDraftProposal(user, { enquiryId: e.id });
  };

  it("the migration gives every business with contract terms a default Standard contract with them", async () => {
    const withTerms = await createTestAgency(prisma, "ctypes-mig", { contractTerms: "  Cancel 30 days ahead.\n" });
    const without = await createTestAgency(prisma, "ctypes-mig-none", { contractTerms: "   " });
    others.push(withTerms.agency.id, without.agency.id);
    // The migration's own SQL, run in a transaction that's then rolled back, so nothing else is changed.
    const sql = readFileSync(path.resolve(__dirname, "../prisma/migrations/20261219000000_contract_types/migration.sql"), "utf8");
    const statements = sql
      .slice(sql.indexOf("-- data:start"), sql.indexOf("-- data:end"))
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .split(/;\s*\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(1);
    const ROLLBACK = new Error("rollback");
    let after: { made: Awaited<ReturnType<typeof prisma.contractTemplate.findMany>>; none: number; ours: number } | null = null;
    await prisma
      .$transaction(
        async (tx) => {
          for (const s of statements) await tx.$executeRawUnsafe(s);
          after = {
            made: await tx.contractTemplate.findMany({ where: { agencyId: withTerms.agency.id } }),
            none: await tx.contractTemplate.count({ where: { agencyId: without.agency.id } }),
            // A business that already has contract types is left alone.
            ours: await tx.contractTemplate.count({ where: { agencyId } }),
          };
          throw ROLLBACK;
        },
        { timeout: 30_000 },
      )
      .catch((e) => {
        if (e !== ROLLBACK) throw e;
      });
    const a = after!;
    expect(a.made).toHaveLength(1);
    expect(a.made[0]).toMatchObject({ name: "Standard contract", terms: "Cancel 30 days ahead.", isDefault: true, eventTypes: [] });
    expect(a.made[0].id).toMatch(/^ct[0-9a-f]{32}$/);
    expect(a.none).toBe(0);
    expect(a.ours).toBe(4);
  });

  it("a proposal for a corporate enquiry gets the Corporate contract's terms", async () => {
    const c = await client("Swansea City FC");
    const q = await proposalFor(c.id, "CORPORATE");
    expect(q).toMatchObject({ contractTemplateId: ids.corporate, terms: "Corporate terms.", eventType: "CORPORATE" });
    // A type of event no contract is for gets the default.
    const gig = await proposalFor(c.id, "GIG");
    expect(gig).toMatchObject({ contractTemplateId: ids.standard, terms: "Standard terms." });
  });

  it("the client's own contract wins over the event type", async () => {
    const sony = await client("Sony", ids.corporate);
    const q = await proposalFor(sony.id, "WEDDING");
    expect(q).toMatchObject({ contractTemplateId: ids.corporate, terms: "Corporate terms." });
  });

  it("saving the editor keeps the contract picked and the wording as changed; a new version copies both", async () => {
    const { saveProposal } = await import("@/actions/proposals");
    const { newProposalVersion, publishProposal, termsFor, readyToSend, proposalInclude } = await import("@/lib/proposal-server");
    const c = await client("Celtic Manor");
    const q = await proposalFor(c.id, "WEDDING");
    expect(q.contractTemplateId).toBe(ids.wedding);
    const line = await prisma.quoteLine.findFirstOrThrow({ where: { quoteId: q.id } });
    const lines = JSON.stringify([
      {
        artistId: "",
        description: "Band",
        date: line.date,
        arriveTime: "",
        startTime: "19:00",
        endTime: "",
        venueId: "",
        place: "",
        sale: "500",
        cost: "300",
        vatPct: "",
      },
    ]);
    await expect(
      saveProposal(
        q.id,
        undefined,
        // A wedding offers at least one way to pay the balance (src/lib/proposal-pay.ts).
        form({
          title: q.title,
          eventType: "WEDDING",
          lines,
          payOptions: "TRANSFER",
          contractTemplateId: ids.small,
          terms: "Small event terms, changed for this one.",
        }),
      ),
    ).rejects.toThrow(`REDIRECT /quotes/${q.id}`);
    expect(await prisma.quote.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({
      contractTemplateId: ids.small,
      terms: "Small event terms, changed for this one.",
    });

    // Someone else's contract type can't be picked: it saves as none.
    const stranger = await createTestAgency(prisma, "ctypes-other");
    others.push(stranger.agency.id);
    const theirs = await prisma.contractTemplate.create({ data: { agencyId: stranger.agency.id, name: "Theirs", terms: "Not yours." } });
    await expect(
      saveProposal(q.id, undefined, form({ title: q.title, eventType: "WEDDING", lines, payOptions: "TRANSFER", contractTemplateId: theirs.id, terms: "" })),
    ).rejects.toThrow("REDIRECT");
    const blank = await prisma.quote.findFirstOrThrow({ where: { id: q.id }, include: proposalInclude });
    expect(blank.contractTemplateId).toBeNull();
    // With no wording of its own it falls back to the contract types (the wedding one here), not the old Settings text.
    expect(termsFor(blank)).toBe("Wedding terms.");
    expect(readyToSend(blank, "2026-01-01")).toBeNull();

    await publishProposal(user, q.id);
    const sent = await prisma.quote.findUniqueOrThrow({ where: { id: q.id } });
    expect(sent).toMatchObject({ status: "SENT", terms: "Wedding terms." });

    await prisma.quote.update({ where: { id: q.id }, data: { contractTemplateId: ids.corporate } });
    const next = await newProposalVersion(user, q.id);
    expect(next).toMatchObject({ version: 2, contractTemplateId: ids.corporate, terms: "Wedding terms." });
  });

  it("a wedding proposal with no terms anywhere can't be sent, and says where to add them", async () => {
    const { readyToSend, proposalInclude } = await import("@/lib/proposal-server");
    const bare = await createTestAgency(prisma, "ctypes-bare");
    others.push(bare.agency.id);
    const c = await prisma.contact.create({ data: { agencyId: bare.agency.id, name: "Hannah", type: "CLIENT" } });
    const q = await prisma.quote.create({
      data: {
        agencyId: bare.agency.id,
        number: "Q-1",
        contactId: c.id,
        title: "Wedding",
        eventType: "WEDDING",
        lines: { create: [{ sort: 0, date: "2030-06-01", startTime: "19:00", saleMinor: 1000 }] },
      },
      include: proposalInclude,
    });
    expect(readyToSend(q, "2026-01-01")).toMatch(/Settings, Contracts and invoices/);
  });

  it("a booking's contract uses the type chosen for it, then the client's, then the event type's", async () => {
    const { contractSubject } = await import("@/lib/contracts");
    const { setContractType } = await import("@/actions/contracts");
    const sony = await client("Sony", ids.corporate);
    const at = new Date("2030-07-01T18:00:00Z");
    const b = await prisma.booking.create({
      data: { agencyId, reference: `CT-${stamp()}`, eventType: "PRIVATE_PARTY", promoterId: sony.id, arriveBy: at, setStart: at, feeMinor: 50000 },
    });
    const termsOf = async () => {
      const s = (await contractSubject(agencyId, { kind: "booking", id: b.id }))!;
      return { title: s.doc.title, terms: s.doc.sections.find((x) => x.heading === "Terms")?.text, reason: s.picked?.reason };
    };
    // Sony's own contract, over the private party's.
    expect(await termsOf()).toEqual({ title: "Corporate contract", terms: "Corporate terms.", reason: "client" });
    // Chosen on the booking.
    expect(await setContractType("booking", b.id, undefined, form({ contractTemplateId: ids.wedding }))).toEqual({ ok: "Saved." });
    expect(await termsOf()).toEqual({ title: "Wedding contract", terms: "Wedding terms.", reason: "chosen" });
    // Back to automatic; with no client contract, the event type's.
    await setContractType("booking", b.id, undefined, form({ contractTemplateId: "" }));
    await prisma.booking.update({ where: { id: b.id }, data: { promoterId: null } });
    expect(await termsOf()).toEqual({ title: "Musician hire, small events", terms: "Small event terms.", reason: "eventType" });
    // Another business's booking can't be changed from here.
    expect(await setContractType("booking", "not-ours", undefined, form({ contractTemplateId: ids.wedding }))).toEqual({ error: "Not found" });
  });

  it("a wedding's contract uses the customer's own contract, or the one chosen for it", async () => {
    const { contractSubject } = await import("@/lib/contracts");
    const { setContractType } = await import("@/actions/contracts");
    const levy = await client("Levy UK", ids.small);
    const e = await prisma.event.create({ data: { agencyId, name: "Staff party", type: "WEDDING", date: "2030-09-01", customerId: levy.id } });
    expect((await contractSubject(agencyId, { kind: "event", id: e.id }))!.doc.title).toBe("Musician hire, small events");
    await setContractType("event", e.id, undefined, form({ contractTemplateId: ids.corporate }));
    const s = (await contractSubject(agencyId, { kind: "event", id: e.id }))!;
    expect(s.doc.title).toBe("Corporate contract");
    expect(s.doc.sections.at(-1)).toMatchObject({ heading: "Terms", text: "Corporate terms." });
  });

  it("saving a type: one default at a time, and the default can only be moved", async () => {
    const { saveContractType } = await import("@/actions/contract-types");
    expect(
      await saveContractType(
        ids.small,
        undefined,
        form({ name: "Musician hire, small events", terms: "Small event terms.", eventTypes: ["OTHER", "PRIVATE_PARTY", "BOGUS"], isDefault: "on" }),
      ),
    ).toEqual({ ok: "Saved." });
    const after = await prisma.contractTemplate.findMany({ where: { agencyId, isDefault: true } });
    expect(after.map((t) => t.id)).toEqual([ids.small]);
    expect((await prisma.contractTemplate.findUniqueOrThrow({ where: { id: ids.small } })).eventTypes).toEqual(["PRIVATE_PARTY", "OTHER"]);
    // Saved without the tick (the box is shown ticked and fixed on the default): still the default.
    await saveContractType(
      ids.small,
      undefined,
      form({ name: "Musician hire, small events", terms: "Small event terms.", eventTypes: ["PRIVATE_PARTY", "OTHER"] }),
    );
    expect((await prisma.contractTemplate.findUniqueOrThrow({ where: { id: ids.small } })).isDefault).toBe(true);
    expect(await saveContractType(ids.small, undefined, form({ name: " ", terms: "" }))).toEqual({ error: "Give the contract a name, like Wedding contract" });
    // Put the default back.
    await saveContractType(ids.standard, undefined, form({ name: "Standard contract", terms: "Standard terms.", isDefault: "on" }));
    expect((await prisma.contractTemplate.findMany({ where: { agencyId, isDefault: true } })).map((t) => t.id)).toEqual([ids.standard]);
  });

  it("deleting a type asks first, then leaves sent proposals' terms as they were", async () => {
    const { deleteContractType } = await import("@/actions/contract-types");
    const { publishProposal } = await import("@/lib/proposal-server");
    const { addContractTemplate } = await import("@/lib/contract-templates-server");
    const rekom = await addContractTemplate(agencyId, { name: "Rekom contract", terms: "Rekom's terms, as agreed.", eventTypes: ["CLUB_NIGHT"] });
    const c = await client("Rekom", rekom.id);
    const sent = await proposalFor(c.id, "CLUB_NIGHT");
    expect(sent).toMatchObject({ contractTemplateId: rekom.id, terms: "Rekom's terms, as agreed." });
    await publishProposal(user, sent.id);
    const draft = await proposalFor(c.id, "CLUB_NIGHT");

    const asked = await deleteContractType(rekom.id, undefined, form({}));
    expect(asked?.confirm?.title).toBe("This contract type is in use. Delete it anyway?");
    expect(asked?.confirm?.items.join(" ")).toMatch(
      /1 draft proposal picked it.*1 proposal went out with it.*1 client has it as their own contract \(Rekom\).*keep their own copy of the wording/,
    );
    expect(await prisma.contractTemplate.count({ where: { id: rekom.id } })).toBe(1);

    expect(await deleteContractType(rekom.id, undefined, form({ confirmed: "yes" }))).toEqual({ ok: "Deleted." });
    expect(await prisma.contractTemplate.count({ where: { id: rekom.id } })).toBe(0);
    // The sent proposal and the draft keep their wording; the link to the type is gone, as is the client's.
    expect(await prisma.quote.findUniqueOrThrow({ where: { id: sent.id } })).toMatchObject({
      status: "SENT",
      terms: "Rekom's terms, as agreed.",
      contractTemplateId: null,
    });
    expect(await prisma.quote.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({ terms: "Rekom's terms, as agreed.", contractTemplateId: null });
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).contractTemplateId).toBeNull();
  });

  it("deleting the default makes the first type left the default", async () => {
    const { deleteContractTemplate, contractTemplatesFor } = await import("@/lib/contract-templates-server");
    const solo = await createTestAgency(prisma, "ctypes-default");
    others.push(solo.agency.id);
    const { addContractTemplate } = await import("@/lib/contract-templates-server");
    const first = await addContractTemplate(solo.agency.id, { name: "First" });
    const second = await addContractTemplate(solo.agency.id, { name: "Second" });
    expect([first.isDefault, second.isDefault]).toEqual([true, false]);
    await deleteContractTemplate(solo.agency.id, first.id);
    expect((await contractTemplatesFor(solo.agency.id)).map((t) => [t.name, t.isDefault])).toEqual([["Second", true]]);
    // Someone else's can't be deleted.
    expect(await deleteContractTemplate(agencyId, second.id)).toBeNull();
  });

  it("a client's contract is saved from their form, only if it's one of the business's", async () => {
    const { updateContact } = await import("@/actions/crm");
    const c = await client("Cardiff City FC");
    const fields = { type: "COMPANY", name: "Cardiff City FC", company: "Cardiff City FC" };
    await expect(updateContact(c.id, undefined, form({ ...fields, contractTemplateId: ids.corporate }))).rejects.toThrow("REDIRECT");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).contractTemplateId).toBe(ids.corporate);
    // A form without the field (no contract types yet) leaves it alone.
    await expect(updateContact(c.id, undefined, form(fields))).rejects.toThrow("REDIRECT");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).contractTemplateId).toBe(ids.corporate);
    await expect(updateContact(c.id, undefined, form({ ...fields, contractTemplateId: "" }))).rejects.toThrow("REDIRECT");
    expect((await prisma.contact.findUniqueOrThrow({ where: { id: c.id } })).contractTemplateId).toBeNull();
  });
});
