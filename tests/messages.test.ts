import { describe, expect, it } from "vitest";
import { normalisePhone, redactLinks, renderEmail } from "@/lib/message-format";

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

describe("redactLinks", () => {
  it("hides the key in every kind of secret link, keeping the page", () => {
    for (const p of ["reset-password", "o", "c", "pay", "w", "f", "join", "v", "q"])
      expect(redactLinks(`Open: https://gigsaw.live/${p}/s3cr3t-Tok_en`)).toBe(`Open: https://gigsaw.live/${p}/…`);
  });
  it("keeps the rest of the message and the query string", () => {
    expect(redactLinks("Hi Sam\n\nSet a password: http://localhost:3142/reset-password/abc123?welcome=1\n\nThanks")).toBe(
      "Hi Sam\n\nSet a password: http://localhost:3142/reset-password/…?welcome=1\n\nThanks",
    );
    expect(redactLinks("Pay here (https://x.test/pay/abc) or https://x.test/c/def, thanks")).toBe(
      "Pay here (https://x.test/pay/…) or https://x.test/c/…, thanks",
    );
    // Anything up to the next space or slash counts as the key, so none of it can be left behind.
    expect(redactLinks("Your plan: https://x.test/w/abc.def~ghi")).toBe("Your plan: https://x.test/w/…");
  });
  it("hides every link in a message, in emails, texts and notifications alike", () => {
    const text = "Offer: https://a.test/o/one Contract: https://a.test/c/two Plan: /w/three";
    expect(redactLinks(text)).toBe("Offer: https://a.test/o/… Contract: https://a.test/c/… Plan: /w/…");
  });
  it("leaves other links and look-alike paths alone", () => {
    const text = "See https://gigsaw.live/bookings/abc, https://gigsaw.live/app/gigs/xyz, https://x.test/docs/o/abc and w/o/thing";
    expect(redactLinks(text)).toBe(text);
    expect(redactLinks("https://gigsaw.live/o/")).toBe("https://gigsaw.live/o/");
  });
  it("redacts the plain-text version of a rendered email", () => {
    const { text } = renderEmail({ title: "Reset your password", cta: { label: "Choose a new password", url: "https://gigsaw.live/reset-password/abcdef" } });
    expect(redactLinks(text)).toContain("Choose a new password: https://gigsaw.live/reset-password/…");
    expect(redactLinks(text)).not.toContain("abcdef");
  });
});
