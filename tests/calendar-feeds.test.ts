import { describe, expect, it, vi } from "vitest";
import { ACT_FEED_SELECT, actFeedEvent, actPayMinor, type ActFeedBooking, type ActFeedOptions } from "@/lib/act-calendar";
import { calendarContent, googleEventBody, microsoftEventBody } from "@/lib/calendar-sync/content";
import { detailLine, detailText, fitDescription } from "@/lib/gig-details";
import { buildIcs, fold } from "@/lib/ics";
import { teamFeedEvent, type TeamFeedBooking } from "@/lib/team-calendar";
import { venueFeedEvent } from "@/lib/venue-calendar";

// What each calendar feed says about a gig, and above all which money each one may show:
//   act feeds and acts' Google/Outlook calendars: the act's own pay, and nothing else about money;
//   staff feeds: the booking page's Money panel (sale, booking fee, act's pay, what we make);
//   venue feeds: no money at all.

vi.mock("server-only", () => ({}));

const BASE = "https://app.gigsaw.test";
const unfold = (ics: string) => ics.replace(/\r\n /g, "");

// Easy to spot if they leak: sale £9,876.54, act's cost £555.55, booking fee £313.37, deposit £424.24, VAT 20%.
const DEAL = { dealType: "BUY_SELL", feeMinor: 987654, artistFeeMinor: 55555, commissionPct: 17.5, currency: "GBP" };
const HIDDEN = { bookingFeeMinor: 31337, depositMinor: 42424, vatPct: 20, dealNotes: "SECRET-DEAL", notes: "PRIVATE-NOTE" };
// Every way the sale price, booking fee, VAT, deposit or what the venue pays could be written.
const NEVER_FOR_ACTS = [
  "987654",
  "9876.54",
  "9,876.54",
  "31337",
  "313.37",
  "42424",
  "424.24",
  "2,038",
  "1975",
  "1,975",
  "VAT",
  "Booking fee",
  "booking fee",
  "pays",
  "We make",
  "Deposit",
  "SECRET-DEAL",
  "PRIVATE-NOTE",
];

const PLAN = {
  name: "Hannah & Sam's wedding",
  type: "WEDDING",
  venueText: "",
  guestCount: 120,
  timeline: "14:00 Ceremony\n19:30 First dance; then the band",
  dayContact: "Priya (planner), 07700 900789",
  arrivalInfo: "Park in the top field, load in by the kitchen",
  dressCode: "",
  meals: "Hot meal at 18:00",
  songRequests: "",
  specialNotes: "",
  planExtras: { abcd1234: "Under the oak tree" },
  updatedAt: new Date("2026-06-01T09:15:00Z"),
};

function actGig(over: Partial<ActFeedBooking> = {}): ActFeedBooking {
  return {
    id: "ckgig1",
    artistId: "actOwls",
    status: "CONFIRMED",
    eventName: "",
    timezone: "Europe/London",
    arriveBy: new Date("2026-07-04T17:00:00Z"),
    soundcheckAt: null,
    setStart: new Date("2026-07-04T18:00:00Z"),
    setEnd: null,
    dayContact: "",
    travel: "",
    accommodation: "",
    hospitality: "",
    updatedAt: new Date("2026-06-01T09:15:00Z"),
    artist: { name: "The Velvet Owls" },
    venue: { name: "The Crown", address: "", city: "Leeds", country: "", notes: "" },
    promoter: null,
    agent: null,
    event: null,
    ...DEAL,
    // A whole booking row, as a careless caller might pass: none of these may show.
    ...HIDDEN,
    ...over,
  } as ActFeedBooking;
}

const asAct: ActFeedOptions = { baseUrl: BASE, viewer: { ownActIds: ["actOwls"], person: false }, planExtras: [{ id: "abcd1234", label: "Ceremony spot" }] };

/** Everything an act could see: the feed's whole event, as written, and both providers' events. */
function actSees(b: ActFeedBooking, opts: ActFeedOptions = asAct) {
  const ics = unfold(buildIcs("Gigs", [actFeedEvent(b, opts)], { timezone: "Europe/London" }));
  // Just the event: the time zone block's dates would match some of the numbers looked for.
  const event = ics.slice(ics.indexOf("BEGIN:VEVENT"));
  const c = calendarContent(b, opts);
  return `${event}\n${JSON.stringify(googleEventBody(c, b.id))}\n${JSON.stringify(microsoftEventBody(c))}`;
}

describe("act feed and acts' connected calendars", () => {
  it("shows the act's own fee, and never the sale price, booking fee, VAT, deposit or what the venue pays", () => {
    const seen = actSees(actGig());
    expect(seen).toContain("Your fee: £555.55");
    for (const s of NEVER_FOR_ACTS) expect(seen).not.toContain(s);
  });

  it("works out the act's pay as their gig page does, for every kind of deal", () => {
    expect(actPayMinor({ dealType: "BUY_SELL", feeMinor: 987654, artistFeeMinor: 55555, commissionPct: 15 })).toBe(55555);
    expect(actPayMinor({ dealType: "STANDARD_COMMISSION", feeMinor: 100000, artistFeeMinor: null, commissionPct: 15 })).toBe(85000);
    expect(actPayMinor({ dealType: "FLAT", feeMinor: 40000, artistFeeMinor: null, commissionPct: 15 })).toBe(40000);
    const commission = actSees(actGig({ dealType: "STANDARD_COMMISSION", feeMinor: 100000, artistFeeMinor: null, commissionPct: 15 }));
    expect(commission).toContain("Your fee: £850.00");
    // The gross fee and the commission are the venue's and the agency's business.
    for (const s of ["1,000", "150.00", "ommission"]) expect(commission).not.toContain(s);
  });

  it("leaves the fee out when none is set, rather than saying £0.00", () => {
    const seen = actSees(actGig({ artistFeeMinor: null }));
    expect(seen).not.toMatch(/fee|£/i);
    for (const s of NEVER_FOR_ACTS) expect(seen).not.toContain(s);
  });

  it("never shows a band's fee to a member act whose feed includes the band's gigs", () => {
    // The Velvet Owls' feed includes gigs by The Big Band, which they're part of: that fee isn't theirs.
    const bandGig = actGig({ artistId: "bigBand", artist: { name: "The Big Band" }, artistFeeMinor: 120000 });
    const seen = actSees(bandGig);
    expect(seen).not.toMatch(/fee|£|1,200/i);
    expect(seen).toContain("Act: The Big Band");
  });

  it("names the act on a person's fee line, since a person can be in several acts", () => {
    const asPerson: ActFeedOptions = { ...asAct, viewer: { ownActIds: ["actOwls", "duo"], person: true } };
    expect(actFeedEvent(actGig(), asPerson).description).toContain("Fee for The Velvet Owls: £555.55");
    expect(actFeedEvent(actGig({ artistId: "duo", artist: { name: "Owl Duo" } }), asPerson).description).toContain("Fee for Owl Duo: £555.55");
  });

  it("shows only the fields that are filled in, in the order an act wants them", () => {
    const sparse = actFeedEvent(actGig({ artistFeeMinor: null }), asAct).description;
    expect(sparse).toBe(
      [
        "Act: The Velvet Owls",
        "Venue: The Crown, Leeds",
        "Status: Confirmed",
        "",
        "Arrive by: 18:00",
        "On stage: 19:00",
        "",
        `Details: ${BASE}/app/gigs/ckgig1`,
      ].join("\n"),
    );
    for (const label of [
      "Soundcheck",
      "Finish",
      "Travel",
      "Accommodation",
      "Hospitality",
      "Day contact",
      "Venue notes",
      "Promoter",
      "agent",
      "Wedding",
      "Guests",
    ])
      expect(sparse).not.toContain(label);

    const full = actFeedEvent(
      actGig({
        soundcheckAt: new Date("2026-07-04T17:30:00Z"),
        setEnd: new Date("2026-07-04T21:00:00Z"),
        dayContact: "Sam, 07700 900123",
        travel: "Train from Kings Cross 14:02\nTaxi from the station",
        accommodation: "Premier Inn, booked under Owls",
        hospitality: "Rider: 6 beers, hot meal",
        venue: { name: "The Crown", address: "1 High St", city: "Leeds", country: "UK", notes: "Park behind the pub" },
        promoter: { name: "Jo Bloggs", phone: "07700 900456" },
        agent: { name: "Alex", email: "alex@agency.test" },
        event: PLAN,
      }),
      asAct,
    ).description;
    expect(full).toBe(
      [
        "Act: The Velvet Owls",
        "Venue: The Crown, 1 High St, Leeds, UK",
        "Status: Confirmed",
        "",
        "Arrive by: 18:00",
        "Soundcheck: 18:30",
        "On stage: 19:00",
        "Finish: 22:00",
        "",
        "Your fee: £555.55",
        "",
        "Day contact: Sam, 07700 900123",
        "Travel:",
        "Train from Kings Cross 14:02",
        "Taxi from the station",
        "Accommodation: Premier Inn, booked under Owls",
        "Hospitality: Rider: 6 beers, hot meal",
        "Venue notes: Park behind the pub",
        "Promoter: Jo Bloggs, 07700 900456",
        "Your agent: Alex, alex@agency.test",
        "",
        "Wedding: Hannah & Sam's wedding",
        "Guests: 120",
        "Running order:",
        "14:00 Ceremony",
        "19:30 First dance; then the band",
        "Contact on the day: Priya (planner), 07700 900789",
        "Arrival, parking and load-in: Park in the top field, load in by the kitchen",
        "Food and drink for the acts: Hot meal at 18:00",
        "Ceremony spot: Under the oak tree",
        "",
        `Details: ${BASE}/app/gigs/ckgig1`,
      ].join("\n"),
    );
  });

  it("never shows the event's agency-only notes, nor the act feed's own data beyond its select", () => {
    expect(Object.keys(ACT_FEED_SELECT.event.select)).not.toContain("notes");
    expect(Object.keys(ACT_FEED_SELECT.venue.select)).toEqual(["name", "address", "city", "country", "notes"]);
    const seen = actSees(actGig({ event: { ...PLAN, notes: "AGENCY-ONLY" } as typeof PLAN }));
    expect(seen).not.toContain("AGENCY-ONLY");
  });

  it("uses a venue that isn't on file (a marquee, say) when the gig has no venue", () => {
    const e = actFeedEvent(actGig({ venue: null, event: { ...PLAN, venueText: "Marquee at Hill Farm" } }), asAct);
    expect(e.description).toContain("Venue: Marquee at Hill Farm");
    expect(e.location).toBe("Marquee at Hill Farm");
  });

  it("escapes and folds the details into valid iCalendar, keeping the same UID", () => {
    const b = actGig({
      travel: "Leeds, then York; back by 02:00\\ish",
      venue: { name: "The Crown; Upstairs", address: "1 High St", city: "Leeds", country: "UK", notes: "🚐 Van parking, rear gate".repeat(4) },
    });
    const ics = buildIcs("Feed", [actFeedEvent(b, asAct)], { timezone: "Europe/London" });
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
      // A fold never splits an escape or an emoji.
      expect(line).not.toMatch(/(^|[^\\])(\\\\)*\\$/);
      expect(line).not.toMatch(/[\ud800-\udbff]$/);
    }
    const flat = unfold(ics);
    expect(flat).toContain("UID:ckgig1@gigsaw\r\n");
    expect(flat).toContain("Travel: Leeds\\, then York\\; back by 02:00\\\\ish\\n");
    expect(flat).toContain("Venue notes: 🚐 Van parking\\, rear gate🚐");
    expect(flat.match(/^DESCRIPTION:.*$/m)![0]).not.toMatch(/[\r\n]/);
  });

  it("dates the event by the later of the booking and its wedding plan", () => {
    const later = new Date("2026-06-05T12:00:00Z");
    expect(actFeedEvent(actGig({ event: { ...PLAN, updatedAt: later } }), asAct).updated).toEqual(later);
    expect(actFeedEvent(actGig(), asAct).updated).toEqual(new Date("2026-06-01T09:15:00Z"));
  });
});

describe("staff feed", () => {
  function staffGig(over: Partial<TeamFeedBooking> = {}): TeamFeedBooking {
    return {
      ...(actGig() as unknown as TeamFeedBooking),
      reference: "GS-0042",
      eventType: "GIG",
      notes: "",
      dealNotes: "",
      vatPct: 20,
      bookingFeeMinor: 31337,
      agent: null,
      ...over,
    };
  }
  const opts = { baseUrl: BASE, agencyTimezone: "Europe/London", planExtras: [] };

  it("shows staff the sale, booking fee, act's pay and what the business makes", () => {
    const d = teamFeedEvent(staffGig(), opts).description!;
    // VAT on the sale and the booking fee: (9,876.54 + 313.37) x 20% = 2,037.98.
    expect(d).toContain("Venue pays: £9,876.54 + £2,037.98 VAT\nBooking fee: £313.37\nAct is paid: £555.55\nWe make: £9,634.36");
    expect(d).not.toContain("424.24"); // no deposit
  });
});

describe("venue feed", () => {
  const entry = {
    id: "ckgig1",
    start: new Date("2026-07-04T18:00:00Z"),
    end: new Date("2026-07-04T20:00:00Z"),
    arriveBy: new Date("2026-07-04T17:00:00Z"),
    artist: "The Velvet Owls",
    genre: "Indie, folk",
    act: "",
    provisional: false,
  };
  const opts = { venueName: "The Crown", timezone: "Europe/London", lineupUrl: `${BASE}/v/tok`, now: new Date("2026-06-01T00:00:00Z") };

  it("shows the act, times and line-up link, and never any money", () => {
    const e = venueFeedEvent({ ...entry, ...DEAL, ...HIDDEN } as typeof entry, opts);
    expect(e.uid).toBe("ckgig1@gigsaw-venue");
    expect(e.description).toBe(
      ["Act: The Velvet Owls", "Style: Indie, folk", "", "Arrive by: 18:00", "On stage: 19:00", "Finish: 21:00", "", `Line-up: ${BASE}/v/tok`].join("\n"),
    );
    const ics = unfold(buildIcs("What's on", [e], { timezone: "Europe/London" }));
    for (const s of [...NEVER_FOR_ACTS, "555.55", "£", "fee"]) expect(ics).not.toContain(s);
  });

  it("says when a gig is provisional, and leaves out what isn't known", () => {
    const e = venueFeedEvent({ ...entry, genre: "", end: null, act: "Quiz night", provisional: true }, opts);
    expect(e.summary).toBe("The Velvet Owls (Quiz night) [provisional]");
    expect(e.description).toBe(
      [
        "Act: The Velvet Owls",
        "Event: Quiz night",
        "Status: Provisional, not confirmed yet",
        "",
        "Arrive by: 18:00",
        "On stage: 19:00",
        "",
        `Line-up: ${BASE}/v/tok`,
      ].join("\n"),
    );
  });
});

describe("detail helpers", () => {
  it("drops blank values and groups, and puts a value over several lines under its label", () => {
    expect(detailLine("Travel", "  ")).toBe("");
    expect(detailLine("Travel", null)).toBe("");
    expect(detailLine("Travel", "Train\r\nTaxi ")).toBe("Travel:\nTrain\nTaxi");
    expect(detailText([["", detailLine("A", "1")], [""], [detailLine("B", "2")]])).toBe("A: 1\n\nB: 2");
  });

  it("cuts an over-long description but keeps the link", () => {
    const out = fitDescription(`${"x".repeat(100)}\n\nDetails: L`, 40, "Details: L");
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith("…\n\nDetails: L")).toBe(true);
  });

  it("folds without splitting an escape", () => {
    const line = `DESCRIPTION:${"a".repeat(62)}\\,b`;
    expect(fold(line).split("\r\n")[0].endsWith("\\")).toBe(false);
    expect(fold(line).replace(/\r\n /g, "")).toBe(line);
  });
});
