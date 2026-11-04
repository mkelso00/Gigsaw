import { describe, expect, it } from "vitest";
import { clientIp } from "@/lib/client-ip";
import { LOGIN_WINDOW_MS, lockedMessage, lockedUntil, MAX_PER_EMAIL } from "@/lib/login-limit";

const now = new Date("2026-11-26T12:00:00Z");
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000);

describe("lockedUntil", () => {
  it("stays open below the limit", () => {
    expect(lockedUntil([], 10, now)).toBeNull();
    expect(
      lockedUntil(
        Array.from({ length: 9 }, (_, i) => minsAgo(i)),
        10,
        now,
      ),
    ).toBeNull();
  });

  it("locks at the limit until the oldest counted failure leaves the window", () => {
    const failures = Array.from({ length: 10 }, (_, i) => minsAgo(i)); // 0 to 9 minutes ago
    expect(lockedUntil(failures, 10, now)).toEqual(new Date(minsAgo(9).getTime() + LOGIN_WINDOW_MS)); // 6 minutes from now
  });

  it("only counts failures inside the window", () => {
    const failures = [...Array.from({ length: 9 }, (_, i) => minsAgo(i)), minsAgo(15), minsAgo(20)];
    expect(lockedUntil(failures, 10, now)).toBeNull();
  });

  it("uses the max-th most recent failure when there are more, in any order", () => {
    const failures = [minsAgo(1), minsAgo(14), minsAgo(2), minsAgo(3), minsAgo(12)];
    // Limit 3: the 3rd most recent is 3 minutes ago, so it opens 12 minutes from now.
    expect(lockedUntil(failures, 3, now)).toEqual(new Date(now.getTime() + 12 * 60_000));
  });

  it("opens exactly when the window has passed", () => {
    const failures = Array.from({ length: MAX_PER_EMAIL }, () => minsAgo(0));
    const until = lockedUntil(failures, MAX_PER_EMAIL, now)!;
    expect(until.getTime() - now.getTime()).toBe(LOGIN_WINDOW_MS);
    expect(lockedUntil(failures, MAX_PER_EMAIL, until)).toBeNull();
    expect(lockedUntil(failures, MAX_PER_EMAIL, new Date(until.getTime() - 1))).not.toBeNull();
  });
});

describe("lockedMessage", () => {
  it("rounds the wait up to whole minutes", () => {
    expect(lockedMessage(new Date(now.getTime() + 61_000), now)).toContain("wait 2 minutes");
    expect(lockedMessage(new Date(now.getTime() + 5_000), now)).toContain("wait 1 minute ");
    expect(lockedMessage(now, now)).toContain("wait 1 minute ");
  });
});

describe("clientIp", () => {
  const h = (values: Record<string, string>) => ({ get: (n: string) => values[n] ?? null });

  it("trusts the last x-forwarded-for entry, which the proxy adds", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("falls back to x-real-ip, then unknown", () => {
    expect(clientIp(h({ "x-real-ip": " 198.51.100.7 " }))).toBe("198.51.100.7");
    expect(clientIp(h({ "x-forwarded-for": "", "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(h({}))).toBe("unknown");
  });
});
