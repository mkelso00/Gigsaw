import { describe, expect, it, vi } from "vitest";
import { cronSecretMatches, runJobs } from "@/lib/cron";

describe("cronSecretMatches", () => {
  const secret = "s3cret-value-for-tests";

  it("accepts the exact bearer header", () => {
    expect(cronSecretMatches(`Bearer ${secret}`, secret)).toBe(true);
  });

  it("rejects a wrong, shorter, longer or differently formatted secret", () => {
    expect(cronSecretMatches("Bearer nope", secret)).toBe(false);
    expect(cronSecretMatches(`Bearer ${secret.slice(0, -1)}`, secret)).toBe(false);
    expect(cronSecretMatches(`Bearer ${secret}x`, secret)).toBe(false);
    expect(cronSecretMatches(secret, secret)).toBe(false);
    expect(cronSecretMatches(`bearer ${secret}`, secret)).toBe(false);
    expect(cronSecretMatches(`Bearer  ${secret}`, secret)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(cronSecretMatches(null, secret)).toBe(false);
    expect(cronSecretMatches(undefined, secret)).toBe(false);
    expect(cronSecretMatches("", secret)).toBe(false);
  });

  it("never matches when no secret is set, even against an empty bearer", () => {
    expect(cronSecretMatches("Bearer ", "")).toBe(false);
    expect(cronSecretMatches("Bearer undefined", undefined)).toBe(false);
    expect(cronSecretMatches("Bearer null", null)).toBe(false);
  });
});

describe("runJobs", () => {
  it("runs every job in order and reports each result", async () => {
    const order: string[] = [];
    const run = await runJobs(
      {
        a: async () => {
          order.push("a");
          return { alerted: 2 };
        },
        b: async () => {
          order.push("b");
          return 5;
        },
      },
      () => {},
    );
    expect(order).toEqual(["a", "b"]);
    expect(run.ok).toBe(true);
    expect(run.jobs.a).toMatchObject({ ok: true, result: { alerted: 2 } });
    expect(run.jobs.b).toMatchObject({ ok: true, result: 5 });
  });

  it("keeps going after a job fails, logs it and marks the run as failed", async () => {
    const log = vi.fn();
    const later = vi.fn(async () => "done");
    const run = await runJobs(
      {
        first: async () => 1,
        broken: async () => {
          throw new Error("database went away");
        },
        later,
      },
      log,
    );
    expect(later).toHaveBeenCalledOnce();
    expect(run.ok).toBe(false);
    expect(run.jobs.first).toMatchObject({ ok: true, result: 1 });
    expect(run.jobs.broken).toMatchObject({ ok: false, error: "database went away" });
    expect(run.jobs.later).toMatchObject({ ok: true, result: "done" });
    expect(log).toHaveBeenCalledOnce();
    expect(log.mock.calls[0][0]).toContain("broken");
  });

  it("copes with a job that throws synchronously or throws a non-Error", async () => {
    const run = await runJobs(
      {
        sync: () => {
          throw "plain string";
        },
        fine: async () => true,
      },
      () => {},
    );
    expect(run.jobs.sync).toMatchObject({ ok: false, error: "plain string" });
    expect(run.jobs.fine).toMatchObject({ ok: true });
  });

  it("times each job", async () => {
    let t = 1000;
    const run = await runJobs(
      {
        slow: async () => {
          t += 250;
        },
      },
      () => {},
      () => t,
    );
    expect(run.jobs.slow.ms).toBe(250);
  });
});
