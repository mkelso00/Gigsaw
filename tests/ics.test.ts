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
    updatedAt: new Date("2026-06-01T09:15:00Z"),
    artist: { name: "The Velvet Owls" },
    venue: { name: "The Crown; Upstairs", address: "1 High St", city: "Leeds", country: "UK" },
    ...over,
  };
}

const opts = { baseUrl: "https://app.gigsaw.live/", agencyTimezone: "Europe/London" };

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
      {
        timezone: "Mars/Olympus",
      },
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
    expect(e.description).toBe(
      [
        "Booking GS-0042",
        "Status: Confirmed",
        "Arrive by 18:00",
        "Soundcheck 18:30",
        "On stage 19:00–21:00",
        "Contact on the day: Sam, 07700 900123",
        "Open in Gigsaw: https://app.gigsaw.live/bookings/ckbooking1",
      ].join("\n"),
    );
    expect(e.url).toBe("https://app.gigsaw.live/bookings/ckbooking1");
  });

  it("marks gigs that aren't on yet, and copes with no act, no venue and no end", () => {
    const e = teamFeedEvent(booking({ status: "PENDING", artist: null, venue: null, eventName: "Smith wedding", setEnd: null }), opts);
    expect(e.summary).toBe("Needs an act @ Smith wedding (Pending)");
    expect(e.end.toISOString()).toBe("2026-07-04T20:00:00.000Z"); // two hours after the set starts
    expect(e.location).toBe("");
    expect(teamFeedEvent(booking({ status: "HOLD", venue: null }), opts).summary).toBe("The Velvet Owls @ venue to be confirmed (On hold)");
  });

  it("says when the venue's times aren't in the agency's time zone", () => {
    const e = teamFeedEvent(booking({ timezone: "Europe/Paris" }), opts);
    expect(e.description).toContain("Arrive by 19:00 (Europe/Paris time)");
  });

  it("never includes money, even if a booking with fees is passed in", () => {
    const withMoney = {
      ...booking(),
      feeMinor: 123456,
      artistFeeMinor: 98765,
      depositMinor: 55555,
      bookingFeeMinor: 4321,
      currency: "GBP",
      dealNotes: "£1,234.56 cash",
    };
    const ics = buildIcs("Bookings", [teamFeedEvent(withMoney as TeamFeedBooking, opts)], { timezone: "Europe/London" });
    for (const s of ["1234", "98765", "55555", "4321", "£", "GBP", "cash", "fee", "Fee"]) expect(unfold(ics)).not.toContain(s);
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
