import { describe, expect, it, vi } from "vitest";
import { checkHealth } from "@/lib/health";

const now = () => new Date("2026-11-04T12:00:00.000Z");

describe("checkHealth", () => {
  it("is healthy when the database answers", async () => {
    const report = await checkHealth({ ping: async () => [{ "?column?": 1 }], now, version: "abc123", log: () => {} });
    expect(report).toEqual({ status: "ok", db: "ok", time: "2026-11-04T12:00:00.000Z", version: "abc123" });
  });

  it("reports the database as down when the ping fails, without leaking the error", async () => {
    const log = vi.fn();
    const report = await checkHealth({
      ping: async () => {
        throw new Error("Can't reach database server at `secret-host:5432`");
      },
      now,
      log,
    });
    expect(report).toEqual({ status: "error", db: "down", time: "2026-11-04T12:00:00.000Z", version: null });
    expect(JSON.stringify(report)).not.toContain("secret-host");
    expect(log).toHaveBeenCalledOnce();
  });

  it("gives up after the timeout when the database hangs", async () => {
    const started = Date.now();
    const report = await checkHealth({ ping: () => new Promise(() => {}), timeoutMs: 50, now, log: () => {} });
    expect(report.status).toBe("error");
    expect(report.db).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it("treats an empty version as unknown", async () => {
    const report = await checkHealth({ ping: async () => 1, version: "", now });
    expect(report.version).toBeNull();
  });
});
