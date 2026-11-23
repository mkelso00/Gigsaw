import { describe, expect, it } from "vitest";
import {
  TEAM_ALERTS,
  bookingContext,
  readRouting,
  resolveRecipients,
  routeField,
  routeFor,
  routeLabels,
  routingFromForm,
  typeContext,
  type TeamPerson,
} from "@/lib/team-alert-routing";

// Where team alerts go: the choice for each alert and context, and who that comes to.

const sam: TeamPerson = { id: "u1", email: "Sam@Agency.test", name: "Sam Jones", phone: "07700 900123", notifyPrefs: {} };

describe("routeFor", () => {
  it("keeps today's behaviour for businesses from before the setting", () => {
    for (const a of TEAM_ALERTS) {
      for (const c of a.contexts) {
        const expected = a.key === "BILLING" || a.key === "PAY_RUN" ? "INBOX" : "AGENT";
        expect(routeFor({}, a.key, c)).toBe(expected);
      }
    }
    // Nothing saved at all reads the same.
    expect(routeFor(null, "ACCEPTED", "EVENTS")).toBe("AGENT");
  });

  it("starts new businesses with wedding and event alerts going to the shared inbox", () => {
    const fresh = { _defaults: "SHARED" };
    expect(routeFor(fresh, "ACCEPTED", "EVENTS")).toBe("INBOX");
    expect(routeFor(fresh, "PLANNER", "EVENTS")).toBe("INBOX");
    expect(routeFor(fresh, "CHECK_INS", "EVENTS")).toBe("INBOX");
    // A late act at a wedding: the agent still gets the text.
    expect(routeFor(fresh, "LATE", "EVENTS")).toBe("BOTH");
    expect(routeFor(fresh, "ACCEPTED", "GIGS")).toBe("AGENT");
    expect(routeFor(fresh, "ENQUIRY", "ALL")).toBe("AGENT");
    expect(routeFor(fresh, "PAY_RUN", "ALL")).toBe("INBOX");
  });

  it("uses what's saved, ignoring anything it doesn't know", () => {
    const saved = { _defaults: "SHARED", ACCEPTED: { EVENTS: "NOBODY", GIGS: "BOTH" }, DECLINED: { GIGS: "nonsense" } };
    expect(routeFor(saved, "ACCEPTED", "EVENTS")).toBe("NOBODY");
    expect(routeFor(saved, "ACCEPTED", "GIGS")).toBe("BOTH");
    expect(routeFor(saved, "DECLINED", "GIGS")).toBe("AGENT");
    expect(routeFor("not an object", "DECLINED", "EVENTS")).toBe("AGENT");
  });

  it("reads alerts with one context in that context, whatever is asked", () => {
    const saved = { PLANNER: { EVENTS: "NOBODY" }, BILLING: { ALL: "BOTH" } };
    expect(routeFor(saved, "PLANNER", "GIGS")).toBe("NOBODY");
    expect(routeFor(saved, "BILLING", "EVENTS")).toBe("BOTH");
  });
});

describe("the settings form", () => {
  it("reads every cell, keeping the current choice for any that's missing", () => {
    const form = new Map<string, string>([
      [routeField("ACCEPTED", "EVENTS"), "INBOX"],
      [routeField("DECLINED", "GIGS"), "BOTH"],
      [routeField("ENQUIRY", "ALL"), "NOBODY"],
      [routeField("LATE", "GIGS"), "EVERYONE"],
    ]);
    const r = routingFromForm((k) => form.get(k) ?? null, { _defaults: "SHARED" });
    expect(r.ACCEPTED).toEqual({ EVENTS: "INBOX", GIGS: "AGENT" });
    expect(r.DECLINED).toEqual({ EVENTS: "INBOX", GIGS: "BOTH" });
    expect(r.LATE).toEqual({ EVENTS: "BOTH", GIGS: "AGENT" });
    expect(r.ENQUIRY).toEqual({ ALL: "NOBODY" });
    expect(r.PLANNER).toEqual({ EVENTS: "INBOX" });
    // Once saved, every cell is there, so the defaults no longer matter.
    expect(readRouting(r)).toEqual(readRouting({ ...r, _defaults: "SHARED" }));
    expect(Object.keys(r)).toHaveLength(TEAM_ALERTS.length);
  });

  it("names the choices in plain words", () => {
    expect(routeLabels("ACCEPTED")).toEqual({ AGENT: "The lead agent", INBOX: "The shared inbox", BOTH: "Both", NOBODY: "Nobody" });
    expect(routeLabels("PAY_RUN").INBOX).toBe("Accounts email");
    expect(routeLabels("BILLING")).toMatchObject({ AGENT: "Admins", INBOX: "Business email" });
    expect(routeLabels("ENQUIRY").AGENT).toBe("As set in Enquiry form");
  });
});

describe("which context", () => {
  it("puts bookings in a wedding or event, or of a customer's own type, with weddings and events", () => {
    expect(bookingContext({ eventId: "e1", eventType: "GIG" })).toBe("EVENTS");
    expect(bookingContext({ eventId: null, eventType: "WEDDING" })).toBe("EVENTS");
    expect(bookingContext({ eventType: "PRIVATE_PARTY" })).toBe("EVENTS");
    expect(bookingContext({ eventType: "CORPORATE" })).toBe("EVENTS");
    expect(bookingContext({ eventId: null, eventType: "GIG" })).toBe("GIGS");
    expect(bookingContext({ eventType: "CLUB_NIGHT" })).toBe("GIGS");
    expect(typeContext("WEDDING")).toBe("EVENTS");
    expect(typeContext("GIG")).toBe("GIGS");
    expect(typeContext(undefined)).toBe("GIGS");
  });
});

describe("resolveRecipients", () => {
  const base = { alert: "DECLINED" as const, inbox: "gigs@agency.test", people: [sam], fallback: "office@agency.test" };

  it("the lead agent: email, text and phone, as their switches say", () => {
    const r = resolveRecipients({ ...base, route: "AGENT" });
    expect(r.emails).toEqual(["Sam@Agency.test"]);
    expect(r.names).toEqual({ "sam@agency.test": "Sam" });
    expect(r.text).toEqual([{ userId: "u1", phone: "07700 900123" }]);
    expect(r.push).toEqual(["u1"]);
  });

  it("the shared inbox: email only, nothing to the agent", () => {
    const r = resolveRecipients({ ...base, route: "INBOX" });
    expect(r).toEqual({ emails: ["gigs@agency.test"], names: {}, push: [], text: [] });
  });

  it("both: the inbox and the agent", () => {
    const r = resolveRecipients({ ...base, route: "BOTH" });
    expect(r.emails).toEqual(["gigs@agency.test", "Sam@Agency.test"]);
    expect(r.text).toHaveLength(1);
  });

  it("nobody", () => {
    expect(resolveRecipients({ ...base, route: "NOBODY" })).toEqual({ emails: [], names: {}, push: [], text: [] });
  });

  it("the shared inbox with no address yet goes to the agent, as before", () => {
    expect(resolveRecipients({ ...base, route: "INBOX", inbox: "  " }).emails).toEqual(["Sam@Agency.test"]);
    expect(resolveRecipients({ ...base, route: "BOTH", inbox: "" }).emails).toEqual(["Sam@Agency.test"]);
  });

  it("with no lead agent, the business email hears, unless the inbox already does", () => {
    expect(resolveRecipients({ ...base, route: "AGENT", people: [] }).emails).toEqual(["office@agency.test"]);
    expect(resolveRecipients({ ...base, route: "INBOX", inbox: "", people: [] }).emails).toEqual(["office@agency.test"]);
    expect(resolveRecipients({ ...base, route: "BOTH", people: [] }).emails).toEqual(["gigs@agency.test"]);
    expect(resolveRecipients({ ...base, route: "AGENT", people: [], fallback: "" }).emails).toEqual([]);
  });

  it("keeps each person's own switches: off is off, by channel, with no business email instead", () => {
    const off: TeamPerson = { ...sam, notifyPrefs: { DECLINED: { email: false } } };
    const a = resolveRecipients({ ...base, route: "AGENT", people: [off] });
    expect(a.emails).toEqual([]);
    expect(a.text).toEqual([{ userId: "u1", phone: "07700 900123" }]);
    const b = resolveRecipients({ ...base, route: "BOTH", people: [{ ...sam, notifyPrefs: { DECLINED: { email: false, text: false } } }] });
    expect(b.emails).toEqual(["gigs@agency.test"]);
    expect(b.text).toEqual([]);
  });

  it("alerts with no personal switch go to everyone chosen", () => {
    const r = resolveRecipients({ alert: "CHECK_INS", route: "AGENT", inbox: "", people: [{ ...sam, notifyPrefs: { PLANNER: { email: false } } }] });
    expect(r.emails).toEqual(["Sam@Agency.test"]);
  });

  it("sends to an address once, whatever its case", () => {
    const r = resolveRecipients({ ...base, route: "BOTH", inbox: "sam@agency.test" });
    expect(r.emails).toEqual(["sam@agency.test"]);
  });

  it("several people, e.g. each admin", () => {
    const people = [sam, { ...sam, id: "u2", email: "kim@agency.test", name: "Kim", phone: "" }];
    const r = resolveRecipients({ alert: "BILLING", route: "AGENT", inbox: "office@agency.test", people });
    expect(r.emails).toEqual(["Sam@Agency.test", "kim@agency.test"]);
    expect(r.text).toEqual([{ userId: "u1", phone: "07700 900123" }]);
  });
});
