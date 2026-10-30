import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const db = {
  plan: { findMany: vi.fn() },
  billingSettings: { findUnique: vi.fn() },
};
vi.mock("@/lib/db", () => ({ prisma: db }));

const { allPlans, buildCatalogue, clearPlanCache, loadCatalogue, planByKey, publicPlans } = await import("@/lib/plan-store");
const { priceAmount } = await import("@/lib/stripe");
const plans = await import("@/lib/plans");
const { DEFAULT_PLANS, DEFAULT_BILLING, featuredPlan, monthsFree, newPlanKey, parsePlanInput, PlanError, planForGigs, poundsToMinor, yearlySavingLabel } =
  plans;

const row = (over: Partial<(typeof DEFAULT_PLANS)[number]>) => ({ ...DEFAULT_PLANS[0], createdAt: new Date(), updatedAt: new Date(), ...over });

describe("loading plans", () => {
  beforeEach(() => {
    clearPlanCache();
    db.plan.findMany.mockReset();
    db.billingSettings.findUnique.mockReset();
  });

  it("reads plans and settings from the database, in order", async () => {
    db.plan.findMany.mockResolvedValue([row({ key: "B", name: "B", sortOrder: 20 }), row({ key: "A", name: "A", sortOrder: 10 })]);
    db.billingSettings.findUnique.mockResolvedValue({ id: "default", trialDays: 14, extraUserMonthlyMinor: 1500, extraUserYearlyMinor: 15000 });
    const c = await loadCatalogue();
    expect(c.plans.map((p) => p.key)).toEqual(["A", "B"]);
    expect(c).toMatchObject({ trialDays: 14, extraUserMonthlyMinor: 1500, extraUserYearlyMinor: 15000 });
    // Timestamps aren't passed on.
    expect(Object.keys(c.plans[0])).not.toContain("createdAt");
  });

  it("caches briefly, and reads again once the cache is cleared after a save", async () => {
    db.plan.findMany.mockResolvedValue([row({ key: "A", monthlyMinor: 1000 })]);
    db.billingSettings.findUnique.mockResolvedValue(null);
    expect((await planByKey("A"))?.monthlyMinor).toBe(1000);
    db.plan.findMany.mockResolvedValue([row({ key: "A", monthlyMinor: 2000 })]);
    expect((await planByKey("A"))?.monthlyMinor).toBe(1000);
    expect(db.plan.findMany).toHaveBeenCalledTimes(1);
    clearPlanCache();
    expect((await planByKey("A"))?.monthlyMinor).toBe(2000);
  });

  it("falls back to the original plans if the database can't be read, and tries again next time", async () => {
    db.plan.findMany.mockRejectedValue(new Error("no database"));
    db.billingSettings.findUnique.mockRejectedValue(new Error("no database"));
    const c = await loadCatalogue();
    expect(c.plans.map((p) => p.key)).toEqual(["STARTER", "GROWTH", "AGENCY"]);
    expect(c.trialDays).toBe(DEFAULT_BILLING.trialDays);
    db.plan.findMany.mockResolvedValue([row({ key: "ONLY" })]);
    db.billingSettings.findUnique.mockResolvedValue(null);
    expect((await allPlans()).map((p) => p.key)).toEqual(["ONLY"]);
  });

  it("finds archived plans by key, but only offers public, current ones", async () => {
    db.plan.findMany.mockResolvedValue([
      row({ key: "OLD", archived: true, sortOrder: 1 }),
      row({ key: "SECRET", public: false, sortOrder: 2 }),
      row({ key: "OPEN", sortOrder: 3 }),
    ]);
    db.billingSettings.findUnique.mockResolvedValue(null);
    expect((await planByKey("OLD"))?.archived).toBe(true);
    expect((await publicPlans()).map((p) => p.key)).toEqual(["OPEN"]);
    expect(await planByKey("NOPE")).toBeNull();
  });

  it("prices Stripe from the loaded plans and settings", async () => {
    db.plan.findMany.mockResolvedValue([row({ key: "GROWTH", monthlyMinor: 12300, yearlyMinor: 123000 })]);
    db.billingSettings.findUnique.mockResolvedValue({ trialDays: 30, extraUserMonthlyMinor: 2500, extraUserYearlyMinor: 25000 });
    expect(await priceAmount("GROWTH", "month")).toBe(12300);
    expect(await priceAmount("GROWTH", "year")).toBe(123000);
    expect(await priceAmount("EXTRA_USER", "month")).toBe(2500);
    await expect(priceAmount("MISSING", "month")).rejects.toThrow(/no plan/);
  });

  it("the defaults match what the migration seeds", () => {
    const c = buildCatalogue(null, null);
    expect(c.plans.map((p) => [p.key, p.monthlyMinor, p.yearlyMinor, p.gigsPerMonth, p.includedUsers])).toEqual([
      ["STARTER", 4900, 49000, 50, 2],
      ["GROWTH", 9900, 99000, 200, 2],
      ["AGENCY", 19900, 199000, null, 3],
    ]);
    expect(c).toMatchObject({ trialDays: 30, extraUserMonthlyMinor: 2000, extraUserYearlyMinor: 20000 });
  });
});

describe("plan helpers", () => {
  it("suggests the middle plan and the smallest that fits", () => {
    expect(featuredPlan(DEFAULT_PLANS)?.key).toBe("GROWTH");
    expect(planForGigs(DEFAULT_PLANS, 10)?.key).toBe("STARTER");
    expect(planForGigs(DEFAULT_PLANS, 51)?.key).toBe("GROWTH");
    expect(planForGigs(DEFAULT_PLANS, 5000)?.key).toBe("AGENCY");
    expect(planForGigs([], 5)).toBeNull();
  });

  it("works out months free on yearly", () => {
    expect(monthsFree({ monthlyMinor: 4900, yearlyMinor: 49000 })).toBe(2);
    expect(monthsFree({ monthlyMinor: 1000, yearlyMinor: 12000 })).toBe(0);
    expect(yearlySavingLabel(DEFAULT_PLANS)).toBe("2 months free");
    expect(yearlySavingLabel([...DEFAULT_PLANS, { ...DEFAULT_PLANS[0], key: "X", yearlyMinor: 4900 * 11 }])).toBe("Save by paying yearly");
  });

  it("reads prices in pounds", () => {
    expect(poundsToMinor("49", "price")).toBe(4900);
    expect(poundsToMinor("£1,990.50", "price")).toBe(199050);
    expect(() => poundsToMinor("abc", "price")).toThrow(PlanError);
    expect(() => poundsToMinor("1.234", "price")).toThrow(/penny/);
  });

  it("checks a plan the owner types in", () => {
    const ok = {
      name: " Pro ",
      tagline: "For big agencies",
      monthly: "149",
      yearly: "1490",
      bookings: "",
      includedUsers: "4",
      highlights: "Unlimited bookings\n\n 4 internal users \n",
      public: true,
      sortOrder: "40",
    };
    expect(parsePlanInput(ok)).toEqual({
      name: "Pro",
      tagline: "For big agencies",
      monthlyMinor: 14900,
      yearlyMinor: 149000,
      gigsPerMonth: null,
      includedUsers: 4,
      highlights: ["Unlimited bookings", "4 internal users"],
      public: true,
      sortOrder: 40,
    });
    expect(parsePlanInput({ ...ok, bookings: "300" }).gigsPerMonth).toBe(300);
    expect(() => parsePlanInput({ ...ok, name: "" })).toThrow(/name/);
    expect(() => parsePlanInput({ ...ok, monthly: "0" })).toThrow(/free account/);
    expect(() => parsePlanInput({ ...ok, bookings: "2.5" })).toThrow(/whole number/);
    expect(() => parsePlanInput({ ...ok, includedUsers: "0" })).toThrow(/1 or more/);
  });

  it("makes keys for new plans and refuses clashes", () => {
    expect(newPlanKey("", "Pro plus", [])).toBe("PRO_PLUS");
    expect(newPlanKey("team", "Anything", [])).toBe("TEAM");
    expect(() => newPlanKey("", "Growth", ["GROWTH"])).toThrow(/already/);
    expect(() => newPlanKey("extra user", "x", [])).toThrow(/something else/);
    expect(() => newPlanKey("", "2024", [])).toThrow(/letter/);
  });
});
