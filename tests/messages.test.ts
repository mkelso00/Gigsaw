import { describe, expect, it } from "vitest";
import { normalisePhone, renderEmail } from "@/lib/message-format";

describe("normalisePhone", () => {
  it("turns UK mobile numbers into international format", () => {
    expect(normalisePhone("07700 900111")).toBe("+447700900111");
    expect(normalisePhone("(07700) 900-111")).toBe("+447700900111");
  });
  it("keeps international numbers", () => {
    expect(normalisePhone("+353 1 555 0100")).toBe("+35315550100");
    expect(normalisePhone("0031 20 555 0199")).toBe("+31205550199");
  });
  it("rejects things that aren't phone numbers", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("call me")).toBeNull();
    expect(normalisePhone("123")).toBeNull();
  });
});

describe("renderEmail", () => {
  const out = renderEmail({
    brand: "Northern Lights",
    title: "Your gig has changed",
    intro: "Hi <Sam>",
    changes: [["On stage", "20:00", "20:30"]],
    rows: [["Venue", "Jazz Cafe"]],
    cta: { label: "Open", url: "https://example.com/x?a=1&b=2" },
  });
  it("escapes anything that came from users", () => {
    expect(out.html).toContain("Hi &lt;Sam&gt;");
    expect(out.html).not.toContain("<Sam>");
    expect(out.html).toContain('href="https://example.com/x?a=1&amp;b=2"');
  });
  it("brands the header with the agency name", () => {
    expect(out.html).toContain("Northern Lights");
    expect(out.html).toContain("Sent with Gigsaw for Northern Lights");
  });
  it("shows old and new values for changes", () => {
    expect(out.html).toContain("line-through");
    expect(out.text).toContain("On stage: 20:00 → 20:30");
  });
  it("has a readable plain-text version", () => {
    expect(out.text).toContain("Your gig has changed");
    expect(out.text).toContain("Open: https://example.com/x?a=1&b=2");
    expect(out.text).toContain("Venue: Jazz Cafe");
  });
});
