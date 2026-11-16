import { describe, expect, it } from "vitest";
import { signupLabel, signupStatus } from "@/lib/act-signup";
import {
  actLoginFillsIn,
  leadOf,
  legalName,
  movePlan,
  moveTarget,
  needsLead,
  payeeDetails,
  payeeOf,
  type MoveCandidate,
  type PayAct,
  type PayPerson,
} from "@/lib/payee";

// Who an act's money goes to (src/lib/payee.ts): pay details on people, a lead for each band, and the
// rules for moving details that were on acts onto people. The migration's SQL is checked against
// movePlan in person-pay-details-db.test.ts.

const NONE = {
  bankAccountName: "",
  bankSortCode: "",
  bankAccountNumber: "",
  address: "",
  niNumber: "",
  vatRegistered: false,
  vatNumber: "",
  phone: "",
  detailsCompletedAt: null,
};
const BANK = {
  bankAccountName: "J Bloggs",
  bankSortCode: "12-34-56",
  bankAccountNumber: "12345678",
  address: "1 High St",
  detailsCompletedAt: new Date("2026-11-01"),
};

const person = (id: string, over: Partial<PayPerson> = {}): PayPerson => ({ ...NONE, id, firstName: id, surname: "Bloggs", alias: "", email: "", ...over });
const act = (over: Partial<PayAct> = {}): PayAct => ({
  ...NONE,
  id: "act",
  name: "Wonderlust",
  email: "",
  leadPersonId: null,
  members: [],
  partPeople: [],
  ...over,
});

describe("who an act's invoices go to", () => {
  it("an act with nobody on file: the act itself, from its own details", () => {
    expect(payeeOf(act())).toEqual({ kind: "act" });
    expect(payeeDetails(act({ ...BANK }), { kind: "act" })).toMatchObject({ personId: null, name: "Wonderlust", bankAccountNumber: "12345678" });
  });
  it("a solo act with one person: that person, by their real name (not their stage name)", () => {
    const ellie = person("Ellie", { surname: "Hart", alias: "Ellie Rose", ...BANK });
    const solo = act({ name: "Ellie Rose", members: [ellie] });
    expect(leadOf(solo)?.id).toBe("Ellie");
    expect(payeeOf(solo)).toEqual({ kind: "person", person: ellie });
    expect(payeeDetails(solo, payeeOf(solo)!)).toMatchObject({ personId: "Ellie", name: "Ellie Hart", address: "1 High St" });
    expect(legalName(ellie)).toBe("Ellie Hart");
  });
  it("a band: nobody until staff choose its lead, then the lead", () => {
    const band = act({ members: [person("A"), person("B"), person("C"), person("D")] });
    expect(needsLead(band)).toBe(true);
    expect(payeeOf(band)).toBeNull();
    const chosen = { ...band, leadPersonId: "C" };
    expect(needsLead(chosen)).toBe(false);
    expect(payeeOf(chosen)).toMatchObject({ kind: "person", person: { id: "C" } });
    // A lead who's left the band doesn't count.
    expect(payeeOf({ ...band, leadPersonId: "gone" })).toBeNull();
  });
  it("a band built from acts counts the people in them, and its lead can be one of them", () => {
    const wonderlust = act({ partPeople: [person("Graham"), person("Jo")] });
    expect(needsLead(wonderlust)).toBe(true);
    expect(payeeOf({ ...wonderlust, leadPersonId: "Jo" })).toMatchObject({ kind: "person", person: { id: "Jo" } });
  });
  it("details from before still on the act keep paying it, until the lead has their own", () => {
    const band = act({ ...BANK, members: [person("A"), person("B")] });
    expect(payeeOf(band)).toEqual({ kind: "act" });
    expect(needsLead(band)).toBe(true);
    expect(payeeOf({ ...band, leadPersonId: "A" })).toEqual({ kind: "act" });
    const withTheirs = act({ ...BANK, leadPersonId: "A", members: [person("A", { ...BANK, bankAccountNumber: "87654321" }), person("B")] });
    expect(payeeOf(withTheirs)).toMatchObject({ kind: "person", person: { id: "A" } });
  });
});

describe("whose details an act's own login fills in", () => {
  it("its only person's, the act's own with nobody on file, and nobody's once a band's lead is chosen", () => {
    expect(actLoginFillsIn(act({ members: [person("Ellie")] }))).toMatchObject({ kind: "person", person: { id: "Ellie" } });
    expect(actLoginFillsIn(act())).toEqual({ kind: "act" });
    const band = act({ members: [person("A"), person("B")] });
    expect(actLoginFillsIn(band)).toEqual({ kind: "act" });
    expect(actLoginFillsIn({ ...band, leadPersonId: "A" })).toBeNull();
    // A band built from acts: the people there give their own.
    expect(actLoginFillsIn(act({ partPeople: [person("Graham")] }))).toBeNull();
  });
});

describe("moving details from acts to people", () => {
  const m = (id: string, email = "", address = "") => ({ id, email, address });
  const cand = (over: Partial<MoveCandidate> = {}): MoveCandidate => ({ id: "act", email: "", address: "1 High St", hasDetails: true, members: [], ...over });
  it("moves to the act's only member", () => {
    expect(moveTarget(cand({ members: [m("ellie")] }))).toEqual({ personId: "ellie", byEmail: false });
  });
  it("moves to the one member whose email is the act's, in any case", () => {
    const band = cand({ email: " Michael@Band.example ", members: [m("michael", "michael@band.example"), m("kerry"), m("dev", "dev@x.example")] });
    expect(moveTarget(band)).toEqual({ personId: "michael", byEmail: true });
  });
  it("leaves them on the act when it isn't clear", () => {
    expect(moveTarget(cand())).toBeNull();
    expect(moveTarget(cand({ members: [m("a"), m("b")] }))).toBeNull();
    expect(moveTarget(cand({ email: "x@y", members: [m("a", "x@y"), m("b", "X@Y")] }))).toBeNull();
    expect(moveTarget(cand({ hasDetails: false, members: [m("a")] }))).toBeNull();
    // Their own address is a different one.
    expect(moveTarget(cand({ members: [m("a", "", "9 Other Road")] }))).toBeNull();
  });
  it("the same address typed differently isn't a different one", () => {
    expect(moveTarget(cand({ address: "1 High St,\nLeeds", members: [m("a", "", "1 high st  leeds")] }))?.personId).toBe("a");
  });
  it("never moves two acts' details onto one person, and makes a band's matching member its lead", () => {
    const plan = movePlan([
      cand({ id: "solo", members: [m("graham")] }),
      cand({ id: "duo", email: "g@x", members: [m("graham", "g@x"), m("jo")] }),
      cand({ id: "band", email: "mi@x", members: [m("michael", "mi@x"), m("kerry")] }),
      cand({ id: "ellie", members: [m("ellie")] }),
    ]);
    expect(Object.fromEntries(plan)).toEqual({ band: { personId: "michael", setLead: true }, ellie: { personId: "ellie", setLead: false } });
  });
});

describe("a band's sign-up", () => {
  const login = (passwordHash: string | null) => ({ person: { login: passwordHash === null ? null : { passwordHash } } });
  it("counts its people: 2 of 4 signed up", () => {
    const band = { login: null, members: [login("x"), login("y"), login(""), login(null)] };
    expect(signupStatus(band)).toBe("PARTLY");
    expect(signupLabel(band)).toBe("2 of 4 signed up");
    expect(signupStatus({ login: null, members: [login("x"), login("y")] })).toBe("SIGNED_UP");
    expect(signupStatus({ login: null, members: [login(""), login(null)] })).toBe("LINK_SENT");
    expect(signupStatus({ login: null, members: [login(null), login(null)] })).toBe("NOT_YET");
    expect(signupLabel({ login: null, members: [login(null), login(null)] })).toBe("0 of 2 signed up");
  });
  it("a solo act is as before: its own login or its one person's", () => {
    expect(signupLabel({ login: { passwordHash: "x" }, members: [] })).toBe("Signed up");
    expect(signupLabel({ login: null, members: [login("")] })).toBe("Link sent");
    expect(signupLabel({ login: null })).toBe("Not signed up");
  });
});
