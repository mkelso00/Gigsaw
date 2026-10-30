import { describe, expect, it } from "vitest";
import {
  checkFormStamp,
  embedSnippet,
  enquiryMakes,
  enquiryNote,
  enquiryRows,
  enquiryTitle,
  formStamp,
  isRealDate,
  MIN_FILL_MS,
  parseEnquiry,
  RateLimiter,
  readEnquiryConfig,
  SLUG,
  slugify,
  sourceFrom,
} from "@/lib/enquiries";
import { formatDate } from "@/lib/time";

const acts = [
  { id: "a1", name: "Ellie Rose" },
  { id: "a2", name: "Wonderlust" },
];
const config = readEnquiryConfig({});
const today = "2026-10-30";

function form(fields: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

const good = {
  name: "  Sam   Jones ",
  email: "Sam@Example.COM",
  phone: "07700 900123",
  eventType: "WEDDING",
  date: "2027-06-12",
  startTime: "14:00",
  venue: "The Old Barn, Chester",
  guests: "1,20",
  budget: "about £1,500",
  acts: ["a2", "nope"],
  message: "Hello!\r\n\r\n\r\nWe'd love a band.",
};

describe("enquiry form settings", () => {
  it("shows every field unless switched off, and falls back to the business email", () => {
    expect(Object.values(config.fields).every(Boolean)).toBe(true);
    expect(config.notify).toBe("BUSINESS");
    const c = readEnquiryConfig({ fields: { budget: false }, notify: "USER:abc123", logoUrl: "http://insecure.example/logo.png" });
    expect(c.fields.budget).toBe(false);
    expect(c.fields.date).toBe(true);
    expect(c.notify).toBe("USER:abc123");
    expect(c.logoUrl).toBe("");
    expect(readEnquiryConfig({ notify: "EVERYONE!" }).notify).toBe("BUSINESS");
  });

  it("makes a web address from the business name", () => {
    expect(slugify("Northern Lights Agency")).toBe("northern-lights-agency");
    expect(slugify("Rock & Roll Bookings Ltd.")).toBe("rock-and-roll-bookings-ltd");
    expect(slugify("Café Música")).toBe("cafe-musica");
    expect(slugify("DJ")).toBe("dj-enquiries");
    expect(slugify("!!!")).toBe("enquiries");
    for (const n of ["Northern Lights Agency", "DJ", "!!!", "A very long business name that goes on and on and on"]) expect(SLUG.test(slugify(n))).toBe(true);
    expect(SLUG.test("-bad")).toBe(false);
    expect(SLUG.test("Has Caps")).toBe(false);
  });
});

describe("checking an enquiry", () => {
  it("tidies what was sent and keeps only the business's own acts", () => {
    const d = parseEnquiry(form(good), config, { today, acts });
    expect(d).toMatchObject({
      name: "Sam Jones",
      email: "sam@example.com",
      eventType: "WEDDING",
      date: "2027-06-12",
      startTime: "14:00",
      guests: 120,
      budget: "about £1,500",
      acts: [{ id: "a2", name: "Wonderlust" }],
      message: "Hello!\n\nWe'd love a band.",
    });
  });

  it("explains what's wrong in plain words", () => {
    const bad = (over: Record<string, string>) => () => parseEnquiry(form({ ...good, ...over }), config, { today, acts });
    expect(bad({ name: "" })).toThrow("tell us your name");
    expect(bad({ email: "sam@" })).toThrow("email address");
    expect(bad({ phone: "call me" })).toThrow("phone number");
    expect(bad({ eventType: "RAVE" })).toThrow("type of event");
    expect(bad({ date: "2027-02-31" })).toThrow("date of your event");
    expect(bad({ date: "2026-10-29" })).toThrow("already passed");
    expect(bad({ date: "2040-01-01" })).toThrow("check the date");
    expect(bad({ startTime: "25:00" })).toThrow("start time");
    expect(bad({ guests: "lots" })).toThrow("number of guests");
    expect(bad({ message: "x".repeat(3001) })).toThrow("too long");
    expect(bad({ name: "x".repeat(101) })).toThrow("too long");
    expect(bad({ message: "see http://a.example http://b.example www.c.example" })).toThrow("web links");
  });

  it("only reads the fields the form shows", () => {
    const c = readEnquiryConfig({ fields: { eventType: false, date: false, guests: false, acts: false } });
    const d = parseEnquiry(form({ ...good, eventType: "RAVE", date: "nonsense", guests: "lots" }), c, { today, acts });
    expect(d).toMatchObject({ eventType: "", date: "", startTime: "", guests: null, acts: [] });
    expect(enquiryMakes(d)).toBe("NOTHING");
  });

  it("allows optional fields to be left empty", () => {
    const d = parseEnquiry(form({ name: "Jo", email: "jo@example.com", eventType: "PRIVATE_PARTY", date: "2026-12-31" }), config, { today, acts });
    expect(d).toMatchObject({ phone: "", startTime: "", venue: "", guests: null, budget: "", acts: [], message: "" });
  });

  it("checks real calendar dates", () => {
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2027-02-29")).toBe(false);
    expect(isRealDate("12/06/2027")).toBe(false);
  });
});

describe("what an enquiry makes", () => {
  const d = parseEnquiry(form(good), config, { today, acts });
  it("a wedding becomes a wedding, anything else an Enquiry booking", () => {
    expect(enquiryMakes(d)).toBe("EVENT");
    expect(enquiryMakes({ ...d, eventType: "CORPORATE" })).toBe("BOOKING");
    expect(enquiryMakes({ ...d, eventType: "" })).toBe("BOOKING");
    expect(enquiryTitle(d)).toBe("Sam Jones's wedding");
    expect(enquiryTitle({ ...d, eventType: "PRIVATE_PARTY" })).toBe("Sam Jones: private party");
    expect(enquiryTitle({ ...d, eventType: "" })).toBe("Sam Jones: enquiry");
  });

  it("lists the details, leaving out empty ones", () => {
    const rows = enquiryRows({ ...d, budget: "", name: undefined, email: undefined });
    expect(rows.map(([k]) => k)).toEqual(["Phone", "Type of event", "Date", "Venue or town", "Guests", "Acts they like", "Message"]);
    expect(Object.fromEntries(rows).Date).toBe(`${formatDate(new Date("2027-06-12T12:00:00Z"), "UTC")}, starting 14:00`);
    const note = enquiryNote(d, "www.example.co.uk/weddings");
    expect(note.split("\n")[0]).toBe("Enquiry from the website form (www.example.co.uk/weddings)");
    expect(note).toContain("Acts they like: Wonderlust");
    expect(note).not.toContain("sam@example.com");
  });
});

describe("spam checks", () => {
  const secret = "test-secret";
  const shown = 1_800_000_000_000;

  it("needs a genuine time stamp, and a few seconds to fill the form in", () => {
    const stamp = formStamp(shown, secret);
    expect(checkFormStamp(stamp, secret, shown + 500)).toBe("fast");
    expect(checkFormStamp(stamp, secret, shown + MIN_FILL_MS)).toBe("ok");
    expect(checkFormStamp(stamp, secret, shown + 3 * 86_400_000)).toBe("old");
    expect(checkFormStamp(stamp, "another-secret", shown + 10_000)).toBe("bad");
    // Changing the time to look older doesn't work: the signature no longer matches.
    expect(checkFormStamp(stamp.replace(String(shown), String(shown - 60_000)), secret, shown + 1_000)).toBe("bad");
    expect(checkFormStamp("", secret, shown)).toBe("bad");
    expect(checkFormStamp(formStamp(shown + 3_600_000, secret), secret, shown)).toBe("bad");
  });

  it("limits attempts per key in a sliding window", () => {
    const limit = new RateLimiter(3, 60_000);
    expect([1, 2, 3, 4].map((i) => limit.hit("ip", i * 1000))).toEqual([true, true, true, false]);
    expect(limit.hit("other", 5000)).toBe(true);
    // A minute after the first attempts, there's room again.
    expect(limit.hit("ip", 62_000)).toBe(true);
  });

  it("notes the website it came from, but not our own pages", () => {
    expect(sourceFrom("https://www.example.co.uk/weddings?x=1", "app.gigsaw.live")).toBe("www.example.co.uk/weddings");
    expect(sourceFrom("https://www.example.co.uk/", "app.gigsaw.live")).toBe("www.example.co.uk");
    expect(sourceFrom("https://app.gigsaw.live/enquire/x", "app.gigsaw.live")).toBe("");
    expect(sourceFrom("javascript:alert(1)", "app.gigsaw.live")).toBe("");
    expect(sourceFrom(null, "app.gigsaw.live")).toBe("");
  });
});

describe("embed code", () => {
  it("frames the form and listens for its height from that frame only", () => {
    const code = embedSnippet("https://app.gigsaw.live/enquire/northern-lights");
    expect(code).toContain('src="https://app.gigsaw.live/enquire/northern-lights?embed=1"');
    expect(code).toContain("e.source !== f.contentWindow");
    expect(code).toContain('"gigsaw-enquiry"');
  });
});
