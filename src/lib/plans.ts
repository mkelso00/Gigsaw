// Gigsaw's plans: chosen by how many bookings a business makes a month. They live in the database
// (the Plan and BillingSettings tables) and are edited in the Owner area → Plans; the server loads
// them with src/lib/plan-store.ts. This file only has the shapes and small helpers, so it's safe to
// use in the browser too. DEFAULT_* are what the database was first seeded with, and are used if
// it can't be read.

export type PlanKey = string;

export type Plan = {
  key: PlanKey;
  name: string;
  tagline: string;
  /** Bookings a month included. null means unlimited. */
  gigsPerMonth: number | null;
  /** Price in pence. */
  monthlyMinor: number;
  yearlyMinor: number;
  includedUsers: number;
  highlights: string[];
  /** Shown on the website, at sign-up and in Settings > Plan. Hidden plans can still be given to a business by the owner. */
  public: boolean;
  sortOrder: number;
  /** Can't be chosen any more. Businesses already on it keep it. */
  archived: boolean;
};

export type BillingConfig = {
  trialDays: number;
  /** Each internal user over the plan's included number. */
  extraUserMonthlyMinor: number;
  extraUserYearlyMinor: number;
};

export type Catalogue = BillingConfig & { plans: Plan[] };

export const CURRENCY = "GBP";

export const DEFAULT_BILLING: BillingConfig = { trialDays: 30, extraUserMonthlyMinor: 2000, extraUserYearlyMinor: 20000 };

export const DEFAULT_PLANS: Plan[] = [
  {
    key: "STARTER",
    name: "Starter",
    tagline: "For a small roster getting organised",
    gigsPerMonth: 50,
    monthlyMinor: 4900,
    yearlyMinor: 49000,
    includedUsers: 2,
    highlights: ["Up to 50 bookings a month", "2 internal users", "Unlimited acts, venues and customers", "Act app with check-in"],
    public: true,
    sortOrder: 10,
    archived: false,
  },
  {
    key: "GROWTH",
    name: "Growth",
    tagline: "For busy bar circuits and wedding work",
    gigsPerMonth: 200,
    monthlyMinor: 9900,
    yearlyMinor: 99000,
    includedUsers: 2,
    highlights: ["Up to 200 bookings a month", "2 internal users", "Weddings, planners and automatic emails", "Venue statements and reports"],
    public: true,
    sortOrder: 20,
    archived: false,
  },
  {
    key: "AGENCY",
    name: "Agency",
    tagline: "For agencies running hundreds of bookings",
    gigsPerMonth: null,
    monthlyMinor: 19900,
    yearlyMinor: 199000,
    includedUsers: 3,
    highlights: ["Unlimited bookings", "3 internal users", "Everything in Growth", "Help moving across from Overture"],
    public: true,
    sortOrder: 30,
    archived: false,
  },
];

export const findPlan = (plans: Plan[], key: string | null | undefined) => plans.find((p) => p.key === key) ?? null;

/** Plans a customer can pick for themselves: on the website, not archived, in order. */
export const choosablePlans = (plans: Plan[]) => plans.filter((p) => p.public && !p.archived).sort((a, b) => a.sortOrder - b.sortOrder);

/** The plan to suggest first (and show as the dark card on the website): the middle one. */
export const featuredPlan = (plans: Plan[]) => {
  const list = choosablePlans(plans);
  return list[Math.floor((list.length - 1) / 2)] ?? null;
};

/** The smallest of these plans that fits this many bookings a month. */
export function planForGigs(plans: Plan[], gigs: number): Plan | null {
  return choosablePlans(plans).find((p) => p.gigsPerMonth === null || gigs <= p.gigsPerMonth) ?? null;
}

/** How many months a yearly price saves against paying monthly, rounded to whole months (0 if none). */
export function monthsFree(plan: Pick<Plan, "monthlyMinor" | "yearlyMinor">) {
  if (plan.monthlyMinor <= 0) return 0;
  return Math.max(0, Math.round(12 - plan.yearlyMinor / plan.monthlyMinor));
}

/** "2 months free" when every plan saves the same, "Save by paying yearly" when they differ, or "". */
export function yearlySavingLabel(plans: Plan[]) {
  const saves = [...new Set(plans.map(monthsFree))];
  if (saves.length === 1) return saves[0] > 0 ? `${saves[0]} month${saves[0] === 1 ? "" : "s"} free` : "";
  return saves.some((n) => n > 0) ? "Save by paying yearly" : "";
}

/** A plan key from a name: "Pro plus" becomes PRO_PLUS. */
export function planKeyFrom(name: string) {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

/** Keys can't clash with the extra-user price or the other ways a business can pay. */
export const RESERVED_PLAN_KEYS = ["EXTRA_USER", "FREE", "CUSTOM", "INVOICE", "STRIPE"];

export class PlanError extends Error {}

/** Pounds as typed ("49", "£49.50", "1,990") to pence. */
export function poundsToMinor(input: string, label: string) {
  const clean = input.replace(/[£,\s]/g, "");
  const n = Number(clean);
  if (!clean || !Number.isFinite(n) || n < 0) throw new PlanError(`Enter ${label} in pounds, like 49 or 49.50`);
  const minor = Math.round(n * 100);
  if (Math.abs(n * 100 - minor) > 1e-6) throw new PlanError(`${label.charAt(0).toUpperCase()}${label.slice(1)} can only go down to the penny`);
  return minor;
}

export type PlanInput = {
  name: string;
  tagline: string;
  monthly: string;
  yearly: string;
  /** Blank means unlimited. */
  bookings: string;
  includedUsers: string;
  /** One per line. */
  highlights: string;
  public: boolean;
  sortOrder: string;
};

/** Check a plan the owner typed in. Throws a PlanError with a plain message. */
export function parsePlanInput(input: PlanInput): Omit<Plan, "key" | "archived"> {
  const name = input.name.trim();
  if (!name) throw new PlanError("Give the plan a name");
  if (name.length > 40) throw new PlanError("Keep the name under 40 characters");
  const monthlyMinor = poundsToMinor(input.monthly, "the monthly price");
  const yearlyMinor = poundsToMinor(input.yearly, "the yearly price");
  if (monthlyMinor < 100 || yearlyMinor < 100) throw new PlanError("Prices need to be at least £1. For no charge, make the business a free account instead.");
  let gigsPerMonth: number | null = null;
  if (input.bookings.trim()) {
    const n = Number(input.bookings);
    if (!Number.isInteger(n) || n < 1) throw new PlanError("Bookings a month has to be a whole number, or blank for unlimited");
    gigsPerMonth = n;
  }
  const includedUsers = Number(input.includedUsers || "0");
  if (!Number.isInteger(includedUsers) || includedUsers < 1 || includedUsers > 1000)
    throw new PlanError("Internal users included has to be a whole number, 1 or more");
  const sortOrder = Number(input.sortOrder || "0");
  if (!Number.isInteger(sortOrder)) throw new PlanError("Order has to be a whole number");
  const highlights = input.highlights
    .split("\n")
    .map((h) => h.trim())
    .filter(Boolean)
    .slice(0, 12);
  return { name, tagline: input.tagline.trim(), monthlyMinor, yearlyMinor, gigsPerMonth, includedUsers, highlights, public: input.public, sortOrder };
}

/** Check a new plan's key (made from the name if left blank). */
export function newPlanKey(typed: string, name: string, existing: string[]) {
  const key = planKeyFrom(typed || name);
  if (!key || !/^[A-Z][A-Z0-9_]*$/.test(key)) throw new PlanError("The key has to start with a letter, like PRO");
  if (RESERVED_PLAN_KEYS.includes(key)) throw new PlanError(`${key} is used for something else. Choose another key.`);
  if (existing.includes(key)) throw new PlanError(`There's already a plan with the key ${key}`);
  return key;
}
