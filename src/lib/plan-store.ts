import "server-only";
import { prisma } from "./db";
import { choosablePlans, DEFAULT_BILLING, DEFAULT_PLANS, findPlan, type Catalogue, type Plan } from "./plans";

// The plans, trial length and extra-user prices, from the database. Read on most pages that show a
// price, so cached for a minute and cleared straight away when the owner saves (on this server; any
// other server picks the change up within the minute). If the database can't be read (say, while
// the site is being built) the plans it was first seeded with are used instead.

const TTL = 60_000;
let cache: { at: number; catalogue: Catalogue } | null = null;

type PlanRow = Plan & { createdAt?: Date; updatedAt?: Date };

/** A database row as a Plan (drops the timestamps). */
export function toPlan(r: PlanRow): Plan {
  return {
    key: r.key,
    name: r.name,
    tagline: r.tagline,
    gigsPerMonth: r.gigsPerMonth,
    monthlyMinor: r.monthlyMinor,
    yearlyMinor: r.yearlyMinor,
    includedUsers: r.includedUsers,
    highlights: r.highlights,
    public: r.public,
    sortOrder: r.sortOrder,
    archived: r.archived,
  };
}

/** Build the catalogue from what the database gave back, falling back to the defaults for anything missing. */
export function buildCatalogue(rows: PlanRow[] | null, settings: Partial<Catalogue> | null): Catalogue {
  const plans = (rows?.length ? rows.map(toPlan) : DEFAULT_PLANS).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  return {
    plans,
    trialDays: settings?.trialDays ?? DEFAULT_BILLING.trialDays,
    extraUserMonthlyMinor: settings?.extraUserMonthlyMinor ?? DEFAULT_BILLING.extraUserMonthlyMinor,
    extraUserYearlyMinor: settings?.extraUserYearlyMinor ?? DEFAULT_BILLING.extraUserYearlyMinor,
  };
}

export async function loadCatalogue(): Promise<Catalogue> {
  if (cache && Date.now() - cache.at < TTL) return cache.catalogue;
  const [rows, settings] = await Promise.all([
    prisma.plan.findMany().catch(() => null),
    prisma.billingSettings.findUnique({ where: { id: "default" } }).catch(() => null),
  ]);
  const catalogue = buildCatalogue(rows, settings);
  // Only keep a good read: a failed one is tried again next time.
  if (rows) cache = { at: Date.now(), catalogue };
  return catalogue;
}

export function clearPlanCache() {
  cache = null;
}

/** Every plan, archived and hidden ones included, in order. */
export async function allPlans() {
  return (await loadCatalogue()).plans;
}

/** Plans customers can choose for themselves (shown on the website, not archived). */
export async function publicPlans() {
  return choosablePlans(await allPlans());
}

/** Any plan by its key, archived ones included (a business may still be on one). */
export async function planByKey(key: string | null | undefined) {
  return findPlan(await allPlans(), key);
}
