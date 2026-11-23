import { describe, expect, it } from "vitest";
import { bookAnywayTitle, bookingRefusal, canBookAct, nameList, pickerNote, withNote, type BookableAct } from "@/lib/book-signed-up";

// "Only book acts who've signed up to Gigsaw": who counts as signed up for booking (src/lib/book-signed-up.ts).

const pw = { passwordHash: "hash" };
const noPw = { passwordHash: "" };
const person = (id: string, login: { passwordHash: string } | null = null) => ({ id, name: `Person ${id}`, login });
const act = (over: Partial<BookableAct> = {}): BookableAct => ({
  name: "The Act",
  login: null,
  leadPersonId: null,
  bookBeforeSignupAt: null,
  people: [],
  ...over,
});

describe("canBookAct", () => {
  describe("a solo act", () => {
    it("with nobody on file: its own login, once it has a password", () => {
      expect(canBookAct(act({ login: pw }))).toEqual({ ok: true, approved: false });
      expect(canBookAct(act())).toMatchObject({ ok: false, who: "The Act", why: "They don't have a Gigsaw login yet." });
      expect(canBookAct(act({ login: noPw }))).toMatchObject({ ok: false, why: /sign-up link has been sent/ });
    });

    it("with one person: the act's login or the person's own", () => {
      expect(canBookAct(act({ people: [person("a", pw)] }))).toEqual({ ok: true, approved: false });
      expect(canBookAct(act({ login: pw, people: [person("a")] }))).toEqual({ ok: true, approved: false });
      expect(canBookAct(act({ people: [person("a", noPw)] }))).toMatchObject({ ok: false, who: "Person a", why: /link has been sent/ });
      expect(canBookAct(act({ people: [person("a")] }))).toMatchObject({ ok: false, who: "Person a" });
    });
  });

  describe("a band", () => {
    const band = (lead: { passwordHash: string } | null, others: ({ passwordHash: string } | null)[] = [null, null]) =>
      act({ name: "The Band", leadPersonId: "lead", people: [person("lead", lead), ...others.map((l, i) => person(`m${i}`, l))] });

    it("goes by its lead: the members can follow", () => {
      expect(canBookAct(band(pw))).toEqual({ ok: true, approved: false });
      expect(canBookAct(band(pw, [null, noPw]))).toEqual({ ok: true, approved: false });
    });

    it("isn't signed up while its lead isn't, even if everyone else is", () => {
      expect(canBookAct(band(null, [pw, pw]))).toMatchObject({ ok: false, who: "Person lead", why: /Person lead, who the band's invoices go to/ });
      expect(canBookAct(band(noPw))).toMatchObject({ ok: false, why: /sign-up link has been sent/ });
    });

    it("with nobody chosen to get its invoices: only the band's own login counts", () => {
      const noLead = act({ name: "The Band", people: [person("a", pw), person("b", pw)] });
      expect(canBookAct(noLead)).toMatchObject({ ok: false, who: "The Band", why: /Nobody in the band has been chosen/ });
      expect(canBookAct({ ...noLead, login: pw })).toEqual({ ok: true, approved: false });
    });

    it("a lead who's left the band doesn't count", () => {
      expect(canBookAct(act({ leadPersonId: "gone", people: [person("a", pw), person("b", pw)] }))).toMatchObject({ ok: false });
    });

    it("counts the people in the acts it's built from (a band of two solo acts)", () => {
      // people is everyone, own members first and then the parts' people (see loadBookableActs).
      expect(canBookAct(act({ leadPersonId: "jo", people: [person("graham"), person("jo", pw)] }))).toEqual({ ok: true, approved: false });
    });
  });

  it("an act an admin approved can be booked before signing up, and says so", () => {
    const approved = { bookBeforeSignupAt: new Date("2026-11-20T10:00:00Z") };
    expect(canBookAct(act(approved))).toEqual({ ok: true, approved: true });
    // Signed up since: just signed up.
    expect(canBookAct(act({ ...approved, login: pw }))).toEqual({ ok: true, approved: false });
  });
});

describe("the words", () => {
  it("refuses staff plainly, saying what to do", () => {
    expect(bookingRefusal("Ellie Rose")).toBe(
      "Ellie Rose hasn't signed up to Gigsaw yet, so they can't be booked. Send them their sign-up link (Acts → Ellie Rose), or ask an admin to approve them.",
    );
  });

  it("asks an admin about one act or several", () => {
    expect(bookAnywayTitle(["Ellie Rose"])).toBe("Ellie Rose hasn't signed up to Gigsaw yet");
    expect(bookAnywayTitle(["A", "B", "C"])).toBe("A, B and C haven't signed up to Gigsaw yet");
    expect(nameList([])).toBe("");
  });

  it("marks acts in the pickers", () => {
    expect(pickerNote(undefined)).toBeUndefined();
    expect(pickerNote({ ok: true, approved: false })).toBeUndefined();
    expect(pickerNote({ ok: true, approved: true })).toBe("Approved");
    expect(pickerNote({ ok: false, why: "", who: "" })).toBe("Not signed up");
    expect(withNote("Jazz", "Not signed up")).toBe("Jazz · Not signed up");
    expect(withNote("", undefined)).toBeUndefined();
    expect(withNote(null, "Approved")).toBe("Approved");
  });

  it("never apologises or uses em dashes", () => {
    const all = [bookingRefusal("X"), bookAnywayTitle(["X"]), canBookAct(act()), canBookAct(act({ people: [person("a"), person("b")] }))].map((x) =>
      JSON.stringify(x),
    );
    for (const s of all) expect(s).not.toMatch(/sorry|apolog|—/i);
  });
});
