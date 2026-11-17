import { describe, expect, it } from "vitest";
import { contactLines, DEFAULT_DESIGN, DEFAULT_STEPS, inkOn, parseSteps, readEmailDesign, showsOnWhite, websiteUrl } from "@/lib/email-design";
import { sampleEnquiryEmail } from "@/lib/email-design-sample";
import { renderEmail } from "@/lib/message-format";

describe("email design settings", () => {
  it("fills in anything missing or broken from the defaults", () => {
    expect(readEmailDesign(null)).toEqual(DEFAULT_DESIGN);
    expect(readEmailDesign({ header: "red", accent: "#C9A25B", website: "not a site", steps: "nope" })).toMatchObject({
      header: DEFAULT_DESIGN.header,
      accent: "#c9a25b",
      website: "",
      steps: DEFAULT_STEPS,
    });
    // Steps cleared on purpose stay cleared.
    expect(readEmailDesign({ steps: [] }).steps).toEqual([]);
  });

  it("tidies websites and steps as typed", () => {
    expect(websiteUrl("glazedigital.com")).toBe("https://glazedigital.com");
    expect(websiteUrl("http://www.example.co.uk/acts/")).toBe("http://www.example.co.uk/acts");
    expect(websiteUrl("hello")).toBe("");
    expect(websiteUrl("javascript:alert(1)")).toBe("");
    expect(parseSteps("1. We check\n\n- We send\n• You book\n4) four\n5 five\nsix\nseven")).toEqual(["We check", "We send", "You book", "four", "5 five"]);
    expect(contactLines({ phone: "07700 900123", website: "https://www.example.com" }, "hi@example.com")).toEqual([
      "hi@example.com",
      "07700 900123",
      "example.com",
    ]);
  });

  it("picks text that reads on each colour, and only gives up on near-white buttons", () => {
    expect(inkOn("#15120f")).toBe("#ffffff");
    expect(inkOn("#f4f1ea")).toBe("#15181c");
    expect(inkOn("#c9a25b")).toBe("#15181c");
    expect(showsOnWhite("#c9a25b")).toBe(true);
    expect(showsOnWhite("#fdfcfa")).toBe(false);
  });
});

describe("an email in the business's design", () => {
  const design = { ...DEFAULT_DESIGN, header: "#15120f", accent: "#c9a25b", website: "https://example.com", phone: "07700 900123" };

  it("has their logo, colours, summary card, steps, button and contact footer", () => {
    const { html, text } = renderEmail(sampleEnquiryEmail("Northern Lights", design, { logoUrl: "https://gigsaw.live/brand/abc/logo?v=1" }, "hi@example.com"));
    expect(html).toContain('<img src="https://gigsaw.live/brand/abc/logo?v=1" alt="Northern Lights"');
    expect(html).toContain("background:#15120f;border-radius:16px 16px 0 0");
    expect(html).toContain('background:#c9a25b"><a href="https://example.com"');
    expect(html).toContain(">Your enquiry<");
    expect(html).toContain(">What happens next<");
    expect(html).toContain("hi@example.com&nbsp;&nbsp;·&nbsp;&nbsp;07700 900123&nbsp;&nbsp;·&nbsp;&nbsp;example.com");
    expect(text).toContain("What happens next\n1. We check which of our acts are free on your date.");
    expect(text).toContain("See our acts: https://example.com");
  });

  it("shows the name and initial when there's no logo, and escapes what the business typed", () => {
    const { html } = renderEmail(sampleEnquiryEmail('<Bad & "Co">', { ...design, steps: [] }, {}, ""));
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;Bad &amp; &quot;Co&quot;&gt;");
    expect(html).not.toContain("What happens next");
  });

  it("looks exactly as before for Gigsaw's own emails (no design given)", () => {
    const { html } = renderEmail({ title: "Reset your password", cta: { label: "Reset", url: "https://gigsaw.live/x" } });
    expect(html).toContain('background:#15181c"><a href="https://gigsaw.live/x"');
    expect(html).not.toContain("<img");
  });
});
