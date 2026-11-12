import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { openToken, sealToken } = await import("@/server/token-box");

describe("token box", () => {
  const key = randomBytes(32);
  it("opens what it sealed, and seals the same text differently each time", () => {
    const a = sealToken("refresh-token-123", key);
    expect(openToken(a, key)).toBe("refresh-token-123");
    expect(sealToken("refresh-token-123", key)).not.toBe(a);
    expect(a).not.toContain("refresh-token-123");
  });
  it("refuses a changed value or another key", () => {
    const a = sealToken("secret", key);
    const parts = a.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => openToken(parts.join("."), key)).toThrow();
    expect(() => openToken(a, randomBytes(32))).toThrow();
    expect(() => openToken("plain", key)).toThrow();
  });
  it("needs a 32-byte key", () => {
    expect(() => sealToken("x", null)).toThrow(/CALENDAR_TOKEN_KEY/);
    expect(() => sealToken("x", randomBytes(16))).toThrow();
  });
});
