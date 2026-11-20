import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SELF_BILLING_TEXT } from "@/lib/self-billing";
import { createTestAgency, describeDb, removeTestAgency } from "./helpers/db";

// Acts setting up their own login from the email their agency has (/start), the Your details
// gate in the act app, and who can see bank details and National Insurance numbers. Database
// tests: they run only with TEST_DATABASE_URL (see tests/helpers/db.ts), e.g.
//   TEST_DATABASE_URL=postgresql://…/gigsaw_test npx vitest run tests/act-signup-db.test.ts

const state = vi.hoisted(() => ({
  ip: "10.0.0.1",
  user: null as unknown,
  later: [] as Promise<unknown>[],
  sent: [] as { kind: string; to: string; subject: string; email: { cta?: { url: string } } }[],
}));

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
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": state.ip }),
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
// after() runs the work once the answer has gone; here it's collected so the test can wait for it.
vi.mock("next/server", () => ({ after: (fn: () => Promise<unknown>) => state.later.push(fn()) }));
vi.mock("@/lib/auth", async (orig) => {
  const real = await orig<typeof import("@/lib/auth")>();
  const signedIn = async () => state.user;
  return { ...real, requireUser: signedIn, requireStaff: signedIn, requireAdmin: signedIn, createSession: async () => {} };
});
// Every email goes out as normal (recorded, not sent); a copy is kept here to read the link from.
vi.mock("@/lib/messaging", async (orig) => {
  const real = await orig<typeof import("@/lib/messaging")>();
  return {
    ...real,
    sendEmail: async (m: Parameters<typeof real.sendEmail>[0]) => {
      state.sent.push(m as never);
      return real.sendEmail(m);
    },
  };
});
// The real forms are client components; on the server they only need to show their contents.
vi.mock("@/components/forms", () => ({
  ActionForm: ({ children }: { children: unknown }) => children,
  SubmitButton: ({ children }: { children: unknown }) => children,
}));

type Db = typeof import("@/lib/db");
const empty = undefined as never;
/** A Your details form, with the self-billing agreement ticked (src/lib/self-billing.ts) as the act app asks for it. */
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  const agreed = { selfBilling: "on", selfBillingText: DEFAULT_SELF_BILLING_TEXT.replace(/\{business\}/g, "Northern Test Music") };
  for (const [k, v] of Object.entries({ ...agreed, ...fields })) f.append(k, v);
  return f;
};
const DETAILS = {
  bankAccountName: "Ellie Hart",
  bankSortCode: "11 22 33",
  bankAccountNumber: "12345678",
  address: "1 High St\nLeeds",
  niNumber: "AB 12 34 56 C",
  vatNumber: "",
};
const tokenFrom = (url?: string) => new URL(url ?? "http://x/").pathname.split("/").pop()!;

describeDb("act sign-up and pay details (database)", () => {
  let prisma: Db["prisma"];
  let claim: typeof import("@/lib/act-claim");
  const agencies: string[] = [];
  let agencyId = "";
  let stamp = "";
  let admin: { id: string; email: string; agencyId: string; role: string };
  let n = 0;
  const email = (tag: string) => `${tag}-${stamp}-${++n}@signup.gigsaw.invalid`;

  const flush = async () => {
    await Promise.all(state.later);
    state.later = [];
  };
  const newAct = (data: Record<string, unknown> = {}) => prisma.artist.create({ data: { agencyId, name: `Act ${++n}`, ...data } });

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    claim = await import("@/lib/act-claim");
    const t = await createTestAgency(prisma, "signup", { agencyName: "Northern Test Music", agencyEmail: "office@northern.gigsaw.invalid" });
    agencyId = t.agency.id;
    stamp = t.stamp;
    admin = { ...t.admin, agencyId };
    agencies.push(agencyId);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.loginAttempt.deleteMany({ where: { key: { contains: stamp } } });
    await prisma.message.deleteMany({ where: { to: { contains: stamp } } });
    for (const id of agencies) await removeTestAgency(prisma, id);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    state.sent = [];
    state.ip = `10.${n % 250}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  });

  describe("claiming a login by email", () => {
    it("makes a login for the act with no password, and emails a 24-hour set-up link", async () => {
      const to = email("act");
      const act = await newAct({ email: to.toUpperCase() });
      expect(await claim.sendClaimLink(` ${to.toUpperCase()} `)).toBe("claim");
      const user = await prisma.user.findUniqueOrThrow({ where: { email: to }, include: { passwordResets: true } });
      expect(user).toMatchObject({ artistId: act.id, personId: null, role: "ARTIST", agencyId, passwordHash: "" });
      expect(user.passwordResets).toHaveLength(1);
      const hours = (user.passwordResets[0].expiresAt.getTime() - Date.now()) / 3_600_000;
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThanOrEqual(24);
      // The email names the agency and carries the link; the copy kept in the outbox doesn't.
      expect(state.sent).toHaveLength(1);
      expect(state.sent[0]).toMatchObject({ kind: "WELCOME", to, subject: "Set up your Gigsaw login for Northern Test Music" });
      const token = tokenFrom(state.sent[0].email.cta?.url);
      expect(state.sent[0].email.cta?.url).toContain("/reset-password/");
      const logged = await prisma.message.findFirstOrThrow({ where: { to }, orderBy: { createdAt: "desc" } });
      expect(logged.body).not.toContain(token);
      // Only the hash is stored.
      expect(user.passwordResets[0].tokenHash).not.toBe(token);
    });

    it("gives the same answer whether or not the email is on file, and sends nothing for an unknown one", async () => {
      const { requestClaimLink } = await import("@/actions/claim");
      const known = email("known");
      await newAct({ email: known });
      const unknown = email("nobody");
      const a = await requestClaimLink(empty, form({ email: known }));
      state.ip = "10.250.0.1";
      const b = await requestClaimLink(empty, form({ email: unknown }));
      await flush();
      expect(a).toEqual(b);
      expect(a?.ok).toBe(claim.CLAIM_ANSWER);
      expect(await prisma.user.count({ where: { email: unknown } })).toBe(0);
      expect(await prisma.message.count({ where: { to: unknown } })).toBe(0);
      expect(await prisma.message.count({ where: { to: known } })).toBe(1);
    });

    it("rejects a mistyped email without saying anything about accounts", async () => {
      const { requestClaimLink } = await import("@/actions/claim");
      expect(await requestClaimLink(empty, form({ email: "not-an-email" }))).toEqual({ error: expect.stringMatching(/Check your email/) });
    });

    it("limits requests per email and per address, the same for unknown emails", async () => {
      const { requestClaimLink } = await import("@/actions/claim");
      const onFile = email("limited");
      await newAct({ email: onFile });
      for (const to of [onFile, email("limited-unknown")]) {
        for (let i = 0; i < claim.CLAIM_MAX_PER_EMAIL; i++) {
          state.ip = `10.1.${n}.${i}`;
          expect((await requestClaimLink(empty, form({ email: to })))?.ok).toBe(claim.CLAIM_ANSWER);
        }
        state.ip = `10.2.${n}.1`;
        expect((await requestClaimLink(empty, form({ email: to })))?.error).toMatch(/Too many tries. Please wait \d+ minutes?/);
      }
      state.ip = `10.3.${n}.9`;
      for (let i = 0; i < claim.CLAIM_MAX_PER_IP; i++) await requestClaimLink(empty, form({ email: email("many") }));
      expect((await requestClaimLink(empty, form({ email: email("many") })))?.error).toMatch(/Too many tries/);
      await flush();
    });

    it("sends an ordinary reset link to an email that already has a login", async () => {
      const to = email("existing");
      await prisma.user.create({ data: { email: to, name: "Has Login", passwordHash: "x", role: "ARTIST", agencyId } });
      const before = await prisma.user.count({ where: { agencyId } });
      expect(await claim.sendClaimLink(to)).toBe("reset");
      expect(state.sent[0]).toMatchObject({ kind: "PASSWORD_RESET", to });
      expect(await prisma.user.count({ where: { agencyId } })).toBe(before);
    });

    it("leaves acts that already have a login under another email alone", async () => {
      const to = email("taken");
      const act = await newAct({ email: to });
      await prisma.user.create({ data: { email: email("other"), name: "x", passwordHash: "x", role: "ARTIST", agencyId, artistId: act.id } });
      expect(await claim.sendClaimLink(to)).toBe("none");
      expect(state.sent).toHaveLength(0);
    });

    it("links a person in an act, but not a venue contact", async () => {
      const member = email("member");
      const act = await newAct();
      const person = await prisma.person.create({ data: { agencyId, firstName: "Jo", surname: "Drummond", email: member } });
      await prisma.personAct.create({ data: { personId: person.id, artistId: act.id } });
      expect(await claim.sendClaimLink(member)).toBe("claim");
      expect(await prisma.user.findUnique({ where: { email: member } })).toMatchObject({
        personId: person.id,
        artistId: null,
        role: "ARTIST",
        name: "Jo Drummond",
      });

      const venueContact = email("venue");
      await prisma.person.create({ data: { agencyId, firstName: "Vic", email: venueContact } });
      expect(await claim.sendClaimLink(venueContact)).toBe("none");
      expect(await prisma.user.count({ where: { email: venueContact } })).toBe(0);
    });

    it("with acts in two agencies, joins the one they've been with longest and names the other", async () => {
      const to = email("twoagencies");
      const first = await newAct({ email: to });
      const other = await createTestAgency(prisma, "signup-b", { agencyName: "Harbour Test Music" });
      agencies.push(other.agency.id);
      await prisma.artist.create({ data: { agencyId: other.agency.id, name: "Same act", email: to } });
      expect(await claim.sendClaimLink(to)).toBe("claim");
      expect(await prisma.user.findUnique({ where: { email: to } })).toMatchObject({ agencyId, artistId: first.id });
      const body = await prisma.message.findFirstOrThrow({ where: { to } });
      expect(body.body).toContain("also on file with Harbour Test Music");
    });

    it("two requests at once make one login", async () => {
      const to = email("double");
      await newAct({ email: to });
      const results = await Promise.all([claim.sendClaimLink(to), claim.sendClaimLink(to)]);
      expect(results.filter((r) => r === "claim").length).toBeGreaterThanOrEqual(1);
      expect(await prisma.user.count({ where: { email: to } })).toBe(1);
    });
  });

  describe("the set-up link", () => {
    const setUp = async () => {
      const to = email("link");
      const act = await newAct({ email: to });
      await claim.sendClaimLink(to);
      const token = tokenFrom(state.sent.at(-1)?.email.cta?.url);
      return { to, act, token };
    };

    it("sets the password once, and can't be used again", async () => {
      const { resetPassword } = await import("@/actions/password");
      const { to, act, token } = await setUp();
      await expect(resetPassword(token, empty, form({ password: "a-new-password", confirm: "a-new-password" }))).rejects.toThrow("REDIRECT /app");
      const user = await prisma.user.findUniqueOrThrow({ where: { email: to } });
      expect(user.passwordHash).not.toBe("");
      expect(await prisma.activity.count({ where: { entityId: act.id, action: "set up their app login" } })).toBe(1);
      expect(await resetPassword(token, empty, form({ password: "another-one-1", confirm: "another-one-1" }))).toEqual({
        error: expect.stringMatching(/expired or has already been used/),
      });
      // Asking again now gives an ordinary reset link.
      expect(await claim.sendClaimLink(to)).toBe("reset");
    });

    it("of two submits at once, only one sets a password", async () => {
      const { resetPassword } = await import("@/actions/password");
      const { token } = await setUp();
      const tries = await Promise.allSettled(
        [1, 2, 3].map((i) => resetPassword(token, empty, form({ password: `password-${i}xx`, confirm: `password-${i}xx` }))),
      );
      expect(tries.filter((t) => t.status === "rejected" && String(t.reason).includes("REDIRECT"))).toHaveLength(1);
    });

    it("stops working once it has expired", async () => {
      const { resetPassword } = await import("@/actions/password");
      const { findUsableReset } = await import("@/lib/reset");
      const { to, token } = await setUp();
      await prisma.passwordReset.updateMany({ where: { user: { email: to } }, data: { expiresAt: new Date(Date.now() - 1000) } });
      expect(await findUsableReset(token)).toBeNull();
      expect(await resetPassword(token, empty, form({ password: "a-new-password", confirm: "a-new-password" }))).toEqual({ error: expect.any(String) });
      expect((await prisma.user.findUniqueOrThrow({ where: { email: to } })).passwordHash).toBe("");
    });
  });

  describe("Your details", () => {
    const actLogin = async (data: Record<string, unknown> = {}) => {
      const to = email("details");
      const act = await newAct({ email: to, phone: "07700 900000", ...data });
      const user = await prisma.user.create({ data: { email: to, name: act.name, passwordHash: "x", role: "ARTIST", agencyId, artistId: act.id } });
      state.user = { ...user, agencyId };
      return { act, user };
    };

    it("sends the act to Your details until bank details and address are in, then to add their calendar", async () => {
      const { requireActApp } = await import("@/lib/act-details-server");
      const { saveMyDetails } = await import("@/actions/act-details");
      const { act } = await actLogin();
      await expect(requireActApp()).rejects.toThrow("REDIRECT /app/details");
      // A wrong NI number is refused and nothing is saved.
      expect(await saveMyDetails("act", act.id, empty, form({ ...DETAILS, niNumber: "QQ 12 34 56 C" }))).toEqual({
        error: expect.stringMatching(/National Insurance/),
      });
      await expect(requireActApp()).rejects.toThrow("REDIRECT /app/details");
      await expect(saveMyDetails("act", act.id, empty, form(DETAILS))).rejects.toThrow("REDIRECT /app");
      const saved = await prisma.artist.findUniqueOrThrow({ where: { id: act.id } });
      expect(saved).toMatchObject({ bankSortCode: "11-22-33", bankAccountNumber: "12345678", niNumber: "AB123456C", address: "1 High St\nLeeds" });
      expect(saved.detailsCompletedAt).toBeInstanceOf(Date);
      // Then their gigs go into a calendar, the last required step.
      await expect(requireActApp()).rejects.toThrow("REDIRECT /app/add-calendar");
      await prisma.user.updateMany({ where: { artistId: act.id }, data: { calendarAddedAt: new Date() } });
      expect(await requireActApp()).toMatchObject({ artistId: act.id });
    });

    it("can't save another act's details", async () => {
      const { saveMyDetails } = await import("@/actions/act-details");
      const other = await newAct();
      await actLogin();
      expect(await saveMyDetails("act", other.id, empty, form(DETAILS))).toEqual({ error: expect.stringMatching(/can't change these details/) });
      expect((await prisma.artist.findUniqueOrThrow({ where: { id: other.id } })).niNumber).toBe("");
    });

    it("tells the business email when the bank account changes, with only the last digits", async () => {
      const { saveMyDetails } = await import("@/actions/act-details");
      const { act } = await actLogin({ ...DETAILS, bankSortCode: "11-22-33", niNumber: "AB123456C", detailsCompletedAt: new Date() });
      // Saving without pressing Change keeps the bank details and sends nothing.
      await expect(saveMyDetails("act", act.id, empty, form({ address: "2 New Rd", vatNumber: "" }))).rejects.toThrow("REDIRECT /app/details?saved=1");
      expect(state.sent).toHaveLength(0);
      await expect(
        saveMyDetails("act", act.id, empty, form({ bankAccountName: "Ellie Hart", bankSortCode: "44-55-66", bankAccountNumber: "87654321", vatNumber: "" })),
      ).rejects.toThrow("REDIRECT");
      expect(state.sent).toHaveLength(1);
      expect(state.sent[0]).toMatchObject({ kind: "BANK_CHANGE", to: "office@northern.gigsaw.invalid" });
      const msg = await prisma.message.findFirstOrThrow({ where: { agencyId, kind: "BANK_CHANGE" }, orderBy: { createdAt: "desc" } });
      expect(msg.body).toContain("••••4321");
      expect(msg.body).toContain("••••5678");
      for (const secret of ["87654321", "12345678", "44-55-66", "11-22-33", "AB123456C", "AB 12 34 56 C"]) expect(msg.body).not.toContain(secret);
      expect(await prisma.activity.count({ where: { entityId: act.id, action: "changed their bank details in the app" } })).toBe(1);
    });

    it("a person's login gives their own details, on their person, never the band's", async () => {
      const { payHoldersFor } = await import("@/lib/payee-server");
      const { requireActApp } = await import("@/lib/act-details-server");
      const { saveMyDetails } = await import("@/actions/act-details");
      const to = email("person");
      const person = await prisma.person.create({ data: { agencyId, firstName: "Graham", surname: "McKee", email: to } });
      const band = await newAct({ email: to });
      const mate = await prisma.person.create({ data: { agencyId, firstName: "Mate" } });
      await prisma.personAct.createMany({ data: [person, mate].map((p) => ({ personId: p.id, artistId: band.id })) });
      const user = await prisma.user.create({ data: { email: to, name: "Graham", passwordHash: "x", role: "ARTIST", agencyId, personId: person.id } });
      state.user = { ...user, agencyId };
      expect((await payHoldersFor({ ...user, agencyId })).map((h) => [h.kind, h.id])).toEqual([["person", person.id]]);
      // The gate asks for their own details, even though their mate has none.
      await expect(requireActApp()).rejects.toThrow("REDIRECT /app/details");
      expect(await saveMyDetails("act", band.id, empty, form(DETAILS))).toEqual({ error: expect.stringMatching(/can't change these details/) });
      await expect(saveMyDetails("person", person.id, empty, form(DETAILS))).rejects.toThrow("REDIRECT /app");
      expect(await prisma.person.findUniqueOrThrow({ where: { id: person.id } })).toMatchObject({
        bankAccountNumber: "12345678",
        address: "1 High St\nLeeds",
        detailsCompletedAt: expect.any(Date),
      });
      expect(await prisma.artist.findUniqueOrThrow({ where: { id: band.id } })).toMatchObject({ bankAccountNumber: "", detailsCompletedAt: null });
      await expect(requireActApp()).rejects.toThrow("REDIRECT /app/add-calendar");
      // A bank change is told to the agency under the person's name.
      await expect(
        saveMyDetails("person", person.id, empty, form({ bankAccountName: "G McKee", bankSortCode: "44-55-66", bankAccountNumber: "87654321", vatNumber: "" })),
      ).rejects.toThrow("REDIRECT");
      expect(state.sent.map((m) => m.subject)).toEqual(["Graham McKee changed their bank details"]);
    });

    it("an act's own login fills in its only person's details, and nobody's for a band whose lead gives theirs", async () => {
      const { payHoldersFor } = await import("@/lib/payee-server");
      const solo = await newAct();
      const ellie = await prisma.person.create({ data: { agencyId, firstName: "Ellie", surname: "Hart" } });
      await prisma.personAct.create({ data: { personId: ellie.id, artistId: solo.id } });
      const holders = await payHoldersFor({ artistId: solo.id, personId: null, agencyId });
      expect(holders.map((h) => [h.kind, h.id])).toEqual([["person", ellie.id]]);
      // With nobody on file it's the act's own, as before.
      const alone = await newAct();
      expect((await payHoldersFor({ artistId: alone.id, personId: null, agencyId })).map((h) => [h.kind, h.id])).toEqual([["act", alone.id]]);
      // A band's own login: the act's own until a lead is chosen, then nobody's.
      const band = await newAct();
      const [a, b] = await Promise.all(["A", "B"].map((firstName) => prisma.person.create({ data: { agencyId, firstName } })));
      await prisma.personAct.createMany({ data: [a, b].map((p) => ({ personId: p.id, artistId: band.id })) });
      expect((await payHoldersFor({ artistId: band.id, personId: null, agencyId })).map((h) => h.kind)).toEqual(["act"]);
      await prisma.artist.update({ where: { id: band.id }, data: { leadPersonId: a.id } });
      expect(await payHoldersFor({ artistId: band.id, personId: null, agencyId })).toEqual([]);
    });
  });

  describe("staff", () => {
    const filled = () =>
      newAct({ ...DETAILS, bankSortCode: "11-22-33", bankAccountNumber: "24681357", niNumber: "JG103726A", detailsCompletedAt: new Date("2026-11-01") });
    const staffForm = (a: { name: string }, extra: Record<string, string> = {}) => form({ name: a.name, colour: "#123456", ...extra });

    it("an agent saving the act never changes or clears its pay details", async () => {
      const { updateArtist } = await import("@/actions/crm");
      const act = await filled();
      state.user = { ...admin, role: "AGENT" };
      await expect(updateArtist(act.id, empty, staffForm(act, { genre: "Soul" }))).rejects.toThrow("REDIRECT");
      expect(await prisma.artist.findUniqueOrThrow({ where: { id: act.id } })).toMatchObject({
        genre: "Soul",
        bankAccountNumber: "24681357",
        niNumber: "JG103726A",
        address: DETAILS.address,
        detailsCompletedAt: new Date("2026-11-01"),
      });
    });

    it("an admin can change them; taking one out marks the details missing again", async () => {
      const { updateArtist } = await import("@/actions/crm");
      const act = await filled();
      state.user = admin;
      expect(await updateArtist(act.id, empty, staffForm(act, { niNumber: "nope" }))).toEqual({ error: expect.stringMatching(/National Insurance/) });
      await expect(updateArtist(act.id, empty, staffForm(act, { address: "" }))).rejects.toThrow("REDIRECT");
      expect(await prisma.artist.findUniqueOrThrow({ where: { id: act.id } })).toMatchObject({ address: "", niNumber: "JG103726A", detailsCompletedAt: null });
      await expect(updateArtist(act.id, empty, staffForm(act, { address: "3 Back Lane" }))).rejects.toThrow("REDIRECT");
      expect((await prisma.artist.findUniqueOrThrow({ where: { id: act.id } })).detailsCompletedAt).toBeInstanceOf(Date);
    });

    it("the act page shows agents only whether details are in; admins see them with the NI number masked", async () => {
      const { renderToStaticMarkup } = await import("react-dom/server");
      // Vitest compiles the app's JSX the classic way (tsconfig keeps it for Next), which needs React in scope.
      (globalThis as { React?: unknown }).React = await import("react");
      const { PayDetailsCard } = await import("@/components/pay-details-card");
      const act = await filled();
      const render = async (role: string) => renderToStaticMarkup((await PayDetailsCard({ artistId: act.id, user: { ...admin, role } as never }))!);
      const agent = await render("AGENT");
      expect(agent).toContain("Details complete");
      for (const secret of ["24681357", "11-22-33", "High St", "JG", "26 A"]) expect(agent).not.toContain(secret);
      const asAdmin = await render("ADMIN");
      expect(asAdmin).toContain("24681357");
      expect(asAdmin).toContain("High St");
      expect(asAdmin).toContain("•• •• •• 26 A");
      expect(asAdmin).not.toContain("JG103726A");
      expect(asAdmin).not.toContain("JG 10 37 26 A");
    });

    it("an admin can show the full NI number, and it's noted", async () => {
      const { revealNiNumber } = await import("@/actions/act-details");
      const act = await filled();
      state.user = admin;
      expect(await revealNiNumber("act", act.id, empty)).toEqual({ ok: "JG 10 37 26 A" });
      expect(await prisma.activity.count({ where: { entityId: act.id, action: "viewed the National Insurance number" } })).toBe(1);
    });
  });
});
