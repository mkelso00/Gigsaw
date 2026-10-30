// Gigsaw's plans: chosen by how many gigs a business books a month. Used by the public pricing
// page, sign-up, Settings > Plan and Stripe. Change prices here (and the matching Stripe prices).

export type PlanKey = "STARTER" | "GROWTH" | "AGENCY";

export type Plan = {
  key: PlanKey;
  name: string;
  tagline: string;
  /** Gigs a month included. null means unlimited. */
  gigsPerMonth: number | null;
  /** Price in pence. Yearly is two months free. */
  monthlyMinor: number;
  yearlyMinor: number;
  includedUsers: number;
  highlights: string[];
};

export const CURRENCY = "GBP";
export const TRIAL_DAYS = 30;
/** Each internal user over the plan's included number. */
export const EXTRA_USER_MONTHLY_MINOR = 2000;
export const EXTRA_USER_YEARLY_MINOR = 20000;

export const PLANS: Plan[] = [
  {
    key: "STARTER",
    name: "Starter",
    tagline: "For a small roster getting organised",
    gigsPerMonth: 50,
    monthlyMinor: 4900,
    yearlyMinor: 49000,
    includedUsers: 2,
    highlights: ["Up to 50 bookings a month", "2 internal users", "Unlimited acts, venues and customers", "Act app with check-in"],
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
  },
];

export const planByKey = (key: string | null | undefined) => PLANS.find((p) => p.key === key) ?? null;

/** The smallest plan that fits this many gigs a month. */
export function planForGigs(gigs: number): Plan {
  return PLANS.find((p) => p.gigsPerMonth === null || gigs <= p.gigsPerMonth)!;
}
