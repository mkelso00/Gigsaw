import { describe, expect, it } from "vitest";
import { buildIcs, esc, icsResponse, vtimezone } from "@/lib/ics";
import { feedStatuses, TEAM_FEED_STATUSES, teamFeedEvent, teamFeedWhere, type TeamFeedBooking } from "@/lib/team-calendar";

const unfold = (ics: string) => ics.replace(/\r\n /g, "");

function booking(over: Partial<TeamFeedBooking> = {}): TeamFeedBooking {
  return {
    id: "ckbooking1",
    reference: "GS-0042",
    status: "CONFIRMED",
    eventName: "",
    timezone: "Europe/London",
    arriveBy: new Date("2026-07-04T17:00:00Z"),
    soundcheckAt: new Date("2026-07-04T17:30:00Z"),
    setStart: new Date("2026-07-04T18:00:00Z"),
    setEnd: new Date("2026-07-04T20:00:00Z"),
    dayContact: "Sam, 07700 900123",
    eventType: "GIG",
    travel: "",
    accommodation: "",
    hospitality: "",
    notes: "",
    currency: "GBP",
    dealType: "BUY_SELL",
    feeMinor: 0,
    artistFeeMinor: null,
    commissionPct: 15,
    vatPct: 0,
    bookingFeeMinor: 0,
    dealNotes: "",
    updatedAt: new Date("2026-06-01T09:15:00Z"),
    artist: { name: "The Velvet Owls" },
    venue: { name: "The Crown; Upstairs", address: "1 High St", city: "Leeds", country: "UK", notes: "" },
    promoter: null,
    agent: null,
    event: null,
    ...over,
  };
}

const opts = { baseUrl: "https://app.gigsaw.live/", agencyTimezone: "Europe/London", planExtras: [] };

describe("iCalendar writer", () => {
  it("escapes text values, semicolons included", () => {
    expect(esc("a;b,c\\d\ne")).toBe("a\\;b\\,c\\\\d\\ne");
  });

  it("uses CRLF and folds long lines at 75 octets", () => {
    const ics = buildIcs("Feed", [
      { uid: "1@x", start: new Date("2026-01-01T10:00:00Z"), end: new Date("2026-01-01T11:00:00Z"), summary: "é".repeat(80), updated: new Date(0) },
    ]);
    expect(ics.endsWith("\r\n")).toBe(true);
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(unfold(ics)).toContain(`SUMMARY:${"é".repeat(80)}`);
  });

  it("writes UTC times when no time zone is given", () => {
    const ics = buildIcs("Feed", [
      { uid: "1@x", start: new Date("2026-07-04T17:00:00Z"), end: new Date("2026-07-04T20:00:00Z"), summary: "x", updated: new Date(0) },
    ]);
    expect(ics).toContain("DTSTART:20260704T170000Z");
    expect(ics).not.toContain("BEGIN:VTIMEZONE");
  });

  it("writes times in the agency's time zone with a matching VTIMEZONE", () => {
    const summer = { uid: "s@x", start: new Date("2026-07-04T17:00:00Z"), end: new Date("2026-07-04T20:00:00Z"), summary: "x", updated: new Date(0) };
    const winter = { uid: "w@x", start: new Date("2026-12-04T19:00:00Z"), end: new Date("2026-12-04T22:00:00Z"), summary: "y", updated: new Date(0) };
    const ics = buildIcs("Feed", [summer, winter], { timezone: "Europe/London" });
    expect(ics).toContain("X-WR-TIMEZONE:Europe/London");
    expect(ics).toContain("DTSTART;TZID=Europe/London:20260704T180000"); // BST
    expect(ics).toContain("DTEND;TZID=Europe/London:20260704T210000");
    expect(ics).toContain("DTSTART;TZID=Europe/London:20261204T190000"); // GMT
    expect(ics).toContain("TZID:Europe/London");
    // Clocks go back at 02:00 BST on 25 October 2026.
    expect(ics).toContain(["BEGIN:STANDARD", "DTSTART:20261025T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0000", "TZNAME:GMT", "END:STANDARD"].join("\r\n"));
  });

  it("finds each change of the clocks to the minute", () => {
    const lines = vtimezone("Europe/London", new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z")).join("\n");
    expect(lines).toContain("BEGIN:DAYLIGHT\nDTSTART:20260329T010000\nTZOFFSETFROM:+0000\nTZOFFSETTO:+0100\nTZNAME:BST\nEND:DAYLIGHT");
    expect(lines).toContain("BEGIN:STANDARD\nDTSTART:20261025T020000\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0000");
    // Starting in October, before the clocks go back: that first stretch is still summer time.
    const october = vtimezone("Europe/London", new Date("2026-10-15T15:30:00Z"), new Date("2026-12-01T00:00:00Z")).join("\n");
    expect(october).toContain("BEGIN:DAYLIGHT\nDTSTART:20261015T163000\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0100\nTZNAME:BST\nEND:DAYLIGHT");
    expect(october).toContain("BEGIN:STANDARD\nDTSTART:20261025T020000\nTZOFFSETFROM:+0100\nTZOFFSETTO:+0000\nTZNAME:GMT\nEND:STANDARD");
    expect(vtimezone("Europe/London", new Date("2026-12-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z"))).toContain("BEGIN:STANDARD");
    // A zone without daylight saving and with a half-hour offset.
    const kolkata = vtimezone("Asia/Kolkata", new Date("2026-01-01T00:00:00Z"), new Date("2027-01-01T00:00:00Z"));
    expect(kolkata.filter((l) => l.startsWith("BEGIN:"))).toEqual(["BEGIN:VTIMEZONE", "BEGIN:STANDARD"]);
    expect(kolkata).toContain("TZOFFSETTO:+0530");
    // Southern hemisphere: daylight saving in January.
    const sydney = vtimezone("Australia/Sydney", new Date("2026-01-01T00:00:00Z"), new Date("2026-12-31T00:00:00Z")).join("\n");
    expect(sydney).toMatch(/^BEGIN:VTIMEZONE\nTZID:Australia\/Sydney\nX-LIC-LOCATION:Australia\/Sydney\nBEGIN:DAYLIGHT/);
    expect(sydney).toContain("DTSTART:20260405T030000\nTZOFFSETFROM:+1100\nTZOFFSETTO:+1000");
  });

  it("falls back to UTC for an unknown time zone", () => {
    const ics = buildIcs(
      "Feed",
      [{ uid: "1@x", start: new Date("2026-07-04T17:00:00Z"), end: new Date("2026-07-04T20:00:00Z"), summary: "x", updated: new Date(0) }],
      { timezone: "Mars/Olympus" },
    );
    expect(ics).toContain("DTSTART:20260704T170000Z");
  });
});

describe("staff calendar feed", () => {
  it("titles events 'Act @ Venue' with times, reference and a link back", () => {
    const e = teamFeedEvent(booking(), opts);
    expect(e.summary).toBe("The Velvet Owls @ The Crown; Upstairs");
    expect(e.uid).toBe("ckbooking1@gigsaw-team");
    expect(e.start.toISOString()).toBe("2026-07-04T17:00:00.000Z");
    expect(e.end.toISOString()).toBe("2026-07-04T20:00:00.000Z");
    expect(e.location).toBe("The Crown; Upstairs, 1 High St, Leeds, UK");
    // Only what's filled in: no money set yet, so no money lines.
    expect(e.description).toBe(
      [
        "Booking: GS-0042",
        "Status: Confirmed",
        "Act: The Velvet Owls",
        "Venue: The Crown; Upstairs, 1 High St, Leeds, UK",
        "",
        "Arrive by: 18:00",
        "Soundcheck: 18:30",
        "On stage: 19:00",
        "Finish: 21:00",
        "",
        "Day contact: Sam, 07700 900123",
        "",
        "Open in Gigsaw: https://app.gigsaw.live/bookings/ckbooking1",
      ].join("\n"),
    );
    expect(e.url).toBe("https://app.gigsaw.live/bookings/ckbooking1");
  });

  it("marks gigs that aren't on yet, and copes with no act, no venue and no end", () => {
    const e = teamFeedEvent(booking({ status: "PENDING", artist: null, venue: null, eventName: "Smith wedding", setEnd: null }), opts);
    expect(e.summary).toBe("Needs an act @ Smith wedding (Pending)"); // the event name stands in for the venue, once
    expect(e.end.toISOString()).toBe("2026-07-04T20:00:00.000Z"); // two hours after the set starts
    expect(e.location).toBe("");
    expect(teamFeedEvent(booking({ status: "HOLD", venue: null }), opts).summary).toBe("The Velvet Owls @ venue to be confirmed (On hold)");
  });

  it("puts the event name (e.g. Duo) last, after the venue", () => {
    const e = teamFeedEvent(booking({ eventName: "Duo" }), opts);
    expect(e.summary).toMatch(/ @ .+ · Duo$/);
  });

  it("says when the venue's times aren't in the agency's time zone", () => {
    const e = teamFeedEvent(booking({ timezone: "Europe/Paris" }), opts);
    expect(e.description).toContain("Arrive by: 19:00 (Europe/Paris time)");
  });

  it("shows the booking page's Money panel figures to staff, and nothing else money-wise (no deposit)", () => {
    const withMoney = {
      ...booking(),
      feeMinor: 123456,
      artistFeeMinor: 98765,
      depositMinor: 55555,
      bookingFeeMinor: 4321,
      vatPct: 20,
      dealNotes: "Cash on the night",
    };
    const e = teamFeedEvent(withMoney as TeamFeedBooking, opts);
    expect(e.description).toContain(
      ["Venue pays: £1,234.56 + £255.55 VAT", "Booking fee: £43.21", "Act is paid: £987.65", "We make: £290.12", "Money notes: Cash on the night"].join("\n"),
    );
    expect(e.description).not.toMatch(/Deposit|555\.55/);
    // A wedding is paid for by the client; a sale and cost deal with no cost yet has no margin to show.
    const wedding = teamFeedEvent(booking({ eventType: "WEDDING", feeMinor: 150000, artistFeeMinor: null }), opts);
    expect(wedding.description).toContain("Client pays: £1,500.00");
    expect(wedding.description).not.toMatch(/Act is paid|We make/);
    // A commission deal: the act's pay after commission.
    const commission = teamFeedEvent(booking({ dealType: "STANDARD_COMMISSION", feeMinor: 100000, commissionPct: 15 }), opts);
    expect(commission.description).toContain("Venue pays: £1,000.00\nAct is paid: £850.00\nWe make: £150.00");
  });

  it("shows the itinerary, internal notes and wedding plan, only where filled in", () => {
    const e = teamFeedEvent(
      booking({
        travel: "Train from Kings Cross 14:02",
        accommodation: "",
        hospitality: "  ",
        notes: "Owes us a favour",
        venue: { name: "The Crown", address: "", city: "Leeds", country: "", notes: "Park behind the pub" },
        promoter: { name: "Jo Bloggs", phone: "07700 900456" },
        agent: { name: "Alex" },
        event: {
          name: "Hannah & Sam's wedding",
          type: "WEDDING",
          venueText: "",
          guestCount: 120,
          timeline: "14:00 Ceremony\n19:00 First dance",
          dayContact: "",
          arrivalInfo: "Load in by the kitchen",
          dressCode: "",
          meals: "",
          songRequests: "",
          specialNotes: "",
          planExtras: { abcd1234: "Under the oak tree", zzzz9999: "" },
          updatedAt: new Date("2026-06-03T10:00:00Z"),
        },
      }),
      {
        ...opts,
        planExtras: [
          { id: "abcd1234", label: "Ceremony spot" },
          { id: "zzzz9999", label: "Empty one" },
        ],
      },
    );
    const d = e.description!;
    expect(d).toContain("Agent: Alex");
    expect(d).toContain(
      "Travel: Train from Kings Cross 14:02\nVenue notes: Park behind the pub\nPromoter: Jo Bloggs, 07700 900456\nInternal notes: Owes us a favour",
    );
    expect(d).toContain(
      "Wedding: Hannah & Sam's wedding\nGuests: 120\nRunning order:\n14:00 Ceremony\n19:00 First dance\nArrival, parking and load-in: Load in by the kitchen\nCeremony spot: Under the oak tree",
    );
    for (const empty of ["Accommodation", "Hospitality", "Dress code", "Empty one", "Contact on the day"]) expect(d).not.toContain(empty);
    // The plan changed after the booking did: the event's revision follows the plan.
    expect(e.updated.toISOString()).toBe("2026-06-03T10:00:00.000Z");
  });

  it("gives the same output for the same bookings, so calendars see no change", () => {
    const a = buildIcs("Feed", [teamFeedEvent(booking(), opts)], { timezone: "Europe/London" });
    const b = buildIcs("Feed", [teamFeedEvent(booking(), opts)], { timezone: "Europe/London" });
    expect(a).toBe(b);
    // A change keeps the UID and raises the SEQUENCE, so it replaces the event rather than adding one.
    const changed = buildIcs("Feed", [teamFeedEvent(booking({ updatedAt: new Date("2026-06-02T09:15:00Z") }), opts)], { timezone: "Europe/London" });
    const seq = (ics: string) => Number(ics.match(/SEQUENCE:(\d+)/)![1]);
    expect(changed).toContain("UID:ckbooking1@gigsaw-team");
    expect(seq(changed)).toBeGreaterThan(seq(a));
  });

  it("chooses bookings by lead agent or all, by status, never cancelled or archived", () => {
    const now = new Date("2026-11-21T12:00:00Z");
    const mine = teamFeedWhere({ id: "u1", agencyId: "a1", calendarScope: "MINE", calendarStatuses: "" }, now);
    expect(mine).toMatchObject({ agencyId: "a1", agentId: "u1", archivedAt: null, status: { in: TEAM_FEED_STATUSES } });
    expect(TEAM_FEED_STATUSES).not.toContain("CANCELLED");
    expect((mine.setStart as { gte: Date }).gte.toISOString()).toBe("2026-08-23T12:00:00.000Z");
    const all = teamFeedWhere({ id: "u1", agencyId: "a1", calendarScope: "ALL", calendarStatuses: "CONFIRMED,SETTLED" }, now);
    expect(all).not.toHaveProperty("agentId");
    expect(all.status).toEqual({ in: ["CONFIRMED", "SETTLED"] });
    expect(feedStatuses("CANCELLED")).toEqual(TEAM_FEED_STATUSES);
    expect(feedStatuses("HOLD, CANCELLED")).toEqual(["HOLD"]);
  });
});

describe("feed responses", () => {
  it("sends private caching headers and a 304 when nothing has changed", async () => {
    const body = buildIcs("Feed", []);
    const first = icsResponse(new Request("https://x/feed.ics"), body, { lastModified: new Date("2026-06-01T09:15:00Z") });
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(first.headers.get("cache-control")).toBe("private, max-age=300, must-revalidate");
    expect(first.headers.get("last-modified")).toBe("Mon, 01 Jun 2026 09:15:00 GMT");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^"[\w-]+"$/);
    expect(await first.text()).toBe(body);
    const again = icsResponse(new Request("https://x/feed.ics", { headers: { "If-None-Match": `W/${etag}` } }), body);
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    const changed = icsResponse(new Request("https://x/feed.ics", { headers: { "If-None-Match": etag } }), body + " ");
    expect(changed.status).toBe(200);
  });
});
