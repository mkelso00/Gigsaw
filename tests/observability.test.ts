import { afterEach, describe, expect, it, vi } from "vitest";

const rows = new Map<string, { job: string; lastSuccessAt: Date | null; lastFailureAt: Date | null; lastError: string }>();
vi.mock("@/lib/db", () => ({
  prisma: {
    schedulerHeartbeat: {
      upsert: async ({ where, create, update }: { where: { job: string }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const before = rows.get(where.job);
        const next = before ? { ...before, ...update } : { lastSuccessAt: null, lastFailureAt: null, lastError: "", ...create };
        rows.set(where.job, next as never);
      },
      findMany: async () => [...rows.values()],
    },
  },
}));

const { formatJson, log } = await import("@/server/log");
const { reportRequestError, requestId, safePath } = await import("@/server/report-error");
const { recordRun, schedulerHealth, withHeartbeat } = await import("@/server/scheduler-health");

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("log lines", () => {
  it("are one line of JSON with level, msg, time and the context", () => {
    const err = Object.assign(new Error("boom"), { digest: "123456" });
    const line = formatJson("error", "It broke", { route: "/x", err }, new Date("2026-11-04T10:00:00Z"));
    expect(line).not.toContain("\n");
    const o = JSON.parse(line);
    expect(o).toMatchObject({ level: "error", msg: "It broke", time: "2026-11-04T10:00:00.000Z", route: "/x" });
    expect(o.err).toMatchObject({ name: "Error", message: "boom", digest: "123456" });
    expect(o.err.stack).toContain("boom");
  });

  it("survive a context that can't be written", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(JSON.parse(formatJson("info", "hi", { loop })).msg).toBe("hi");
  });

  it("leave out levels below LOG_LEVEL", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("LOG_LEVEL", "warn");
    log.info("quiet");
    expect(out).not.toHaveBeenCalled();
    vi.stubEnv("LOG_LEVEL", "debug");
    log.debug("loud");
    expect(out).toHaveBeenCalledOnce();
  });
});

describe("request errors", () => {
  it("hide secret link tokens and the query string", () => {
    expect(safePath("/o/abc123secret?x=1", "/o/[token]")).toBe("/o/…");
    expect(safePath("/api/calendar/team/tok", "/api/calendar/team/[token]")).toBe("/api/calendar/team/…");
    expect(safePath("/bookings/ck123", "/bookings/[id]")).toBe("/bookings/ck123");
  });

  it("keep the proxy's request id, or make one", () => {
    expect(requestId({ "x-request-id": "abc-123" })).toBe("abc-123");
    expect(requestId({ "x-railway-request-id": "rw_9" })).toBe("rw_9");
    expect(requestId({ "x-request-id": "bad id with spaces" })).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("are logged as one error line with the digest the error page shows", async () => {
    const out = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("Database is down"), { digest: "2468013579" });
    await reportRequestError(
      err,
      { path: "/v/secret-token", method: "GET", headers: { "x-request-id": "req-1" } },
      { routePath: "/v/[token]", routeType: "render" },
    );
    expect(out).toHaveBeenCalledOnce();
    const o = JSON.parse(String(out.mock.calls[0][0]));
    expect(o).toMatchObject({
      level: "error",
      msg: "Database is down",
      digest: "2468013579",
      route: "/v/[token]",
      method: "GET",
      path: "/v/…",
      requestId: "req-1",
    });
    expect(String(out.mock.calls[0][0])).not.toContain("secret-token");
  });

  it("keep Next's generic repeat of a server component error as a warning", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const repeat = Object.assign(new Error("An error occurred in the Server Components render. The specific message is omitted."), { digest: "999" });
    await reportRequestError(repeat, { path: "/x", method: "GET", headers: {} }, { routePath: "/x", routeType: "render" });
    expect(err).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0][0]))).toMatchObject({ level: "warn", digest: "999" });
  });

  it("go to Sentry as an envelope when SENTRY_DSN is set", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("SENTRY_DSN", "https://pubkey@o1.ingest.sentry.io/42");
    const sent: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      sent.push({ url, init });
      return new Response("{}", { status: 200 });
    });
    await reportRequestError(
      Object.assign(new Error("x"), { digest: "d1" }),
      { path: "/", method: "POST", headers: {} },
      { routePath: "/", routeType: "action" },
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://o1.ingest.sentry.io/api/42/envelope/");
    expect((sent[0].init.headers as Record<string, string>)["X-Sentry-Auth"]).toContain("sentry_key=pubkey");
    const [head, item, event] = String(sent[0].init.body)
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(head.event_id).toBe(event.event_id);
    expect(item.type).toBe("event");
    expect(event.tags).toMatchObject({ digest: "d1", method: "POST", routeType: "action" });
    expect(event.exception.values[0]).toEqual({ type: "Error", value: "x" });
  });
});

describe("scheduler heartbeat", () => {
  it("records the last success and failure of each job", async () => {
    rows.clear();
    const t0 = new Date("2026-11-04T10:00:00Z");
    await recordRun("overdue", { ok: true }, t0);
    await recordRun("reminders", { ok: true }, t0);
    await recordRun("event-emails", { ok: true }, t0);
    await recordRun("calendar-sync", { ok: true }, t0);
    expect((await schedulerHealth({ now: new Date("2026-11-04T10:02:00Z") })).ok).toBe(true);

    await recordRun("reminders", { ok: false, error: new Error("Twilio down") }, new Date("2026-11-04T10:06:00Z"));
    const h = await schedulerHealth({ now: new Date("2026-11-04T10:06:00Z") });
    expect(h.ok).toBe(false);
    const reminders = h.jobs.find((j) => j.job === "reminders")!;
    expect(reminders.lastError).toBe("Twilio down");
    expect(reminders.lastSuccessAt).toEqual(t0);
    expect(reminders.ageMs).toBe(6 * 60_000);
    expect((await schedulerHealth({ now: new Date("2026-11-04T10:06:00Z"), maxAgeMs: 10 * 60_000 })).ok).toBe(true);
  });

  it("counts a job that never ran as not ok", async () => {
    rows.clear();
    const h = await schedulerHealth();
    expect(h.ok).toBe(false);
    expect(h.jobs.map((j) => j.ageMs)).toEqual([null, null, null, null]);
  });

  it("records around a job and passes its result or error on", async () => {
    rows.clear();
    expect(await withHeartbeat("overdue", async () => 7)).toBe(7);
    expect(rows.get("overdue")?.lastSuccessAt).toBeInstanceOf(Date);
    await expect(withHeartbeat("overdue", async () => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
    expect(rows.get("overdue")?.lastError).toBe("nope");
  });
});
