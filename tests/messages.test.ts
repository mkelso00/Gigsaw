import { describe, expect, it } from "vitest";
import { normalisePhone, textToHtml } from "@/lib/message-format";

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

describe("textToHtml", () => {
  it("escapes HTML and links URLs", () => {
    const html = textToHtml("Hi <b>Sam</b>\nOpen https://example.com/x?a=1");
    expect(html).toContain("Hi &lt;b&gt;Sam&lt;/b&gt;<br>");
    expect(html).toContain('<a href="https://example.com/x?a=1"');
  });
});
