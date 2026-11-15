import { describe, expect, it } from "vitest";
import { contrast, gigLook, gigTone, textOn } from "@/lib/calendar-look";
import { recallCalendar, rememberCalendar } from "@/lib/calendar-memory";
import { VENUE_PALETTE } from "@/lib/rota";

describe("calendar colours by status", () => {
  it("gives each status its look", () => {
    expect(gigTone("PENDING")).toBe("pending");
    expect(gigTone("AWAITING")).toBe("awaiting");
    expect(gigTone("CONFIRMED")).toBe("on");
    expect(gigTone("SETTLED")).toBe("on");
    expect(gigTone("HOLD")).toBe("quiet");
    expect(gigTone("ENQUIRY")).toBe("quiet");
    expect(gigTone("CANCELLED")).toBe("cancelled");
  });
  it("shows a booking with no act as pending, but leaves enquiries and cancellations alone", () => {
    expect(gigTone("CONFIRMED", false)).toBe("pending");
    expect(gigTone("HOLD", false)).toBe("pending");
    expect(gigTone("ENQUIRY", false)).toBe("quiet");
    expect(gigTone("CANCELLED", false)).toBe("cancelled");
  });
  it("fills booked gigs with the venue colour and readable text", () => {
    const look = gigLook("CONFIRMED", "#2563eb");
    expect(look.className).toBe("gig gig-on");
    expect(look.style).toEqual({ "--gig": "#2563eb", "--gig-ink": "#ffffff" });
    expect(gigLook("PENDING", "#2563eb")).toEqual({ tone: "pending", className: "gig gig-pending" });
  });
  it("picks text that passes WCAG AA on every venue colour", () => {
    for (const c of [...VENUE_PALETTE, "#a2a199", "#ffffff", "#000000", "#fef08a"]) expect(contrast(c, textOn(c))).toBeGreaterThanOrEqual(4.5);
    expect(textOn("#ca8a04")).toBe("#15181c");
    expect(textOn("not a colour")).toBe("#ffffff");
  });
});

describe("remembering where you were on the calendar", () => {
  const now = Date.UTC(2026, 10, 15, 10);
  it("takes you back to the same view, dates and filters", () => {
    const saved = rememberCalendar("u1", { view: "week", date: "2026-03-09", town: "Leeds", status: "PENDING", colour: "artist", artist: undefined }, now);
    expect(recallCalendar(saved, "u1", now + 60_000)).toBe("view=week&date=2026-03-09&status=PENDING&colour=artist&town=Leeds");
  });
  it("forgets the dates after a working day, but keeps the view and filters", () => {
    const saved = rememberCalendar("u1", { view: "day", date: "2026-03-09", town: "Leeds" }, now);
    expect(recallCalendar(saved, "u1", now + 13 * 3600 * 1000)).toBe("view=day&town=Leeds");
  });
  it("starts afresh for someone else, with no cookie, or when nothing is worth keeping", () => {
    const saved = rememberCalendar("u1", { view: "month", date: "2026-03-01" }, now);
    expect(recallCalendar(saved, "u2", now)).toBeNull();
    expect(recallCalendar(undefined, "u1", now)).toBeNull();
    expect(recallCalendar(rememberCalendar("u1", { date: "2026-03-01" }, now), "u1", now + 86_400_000)).toBeNull();
  });
  it("ignores anything odd in the cookie", () => {
    expect(recallCalendar("u1|" + now + "|view=year&date=nope&status=LOST&colour=red&next=https://evil.test", "u1", now)).toBeNull();
    expect(recallCalendar("garbage", "u1", now)).toBeNull();
  });
});
