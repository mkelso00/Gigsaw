import Link from "next/link";
import { Icon } from "@/components/icons";
import { Empty, PageHeader, Stat } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { monthLabel, unresolvedPastWhere } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { userCharge } from "@/lib/seats";
import { allPlans } from "@/lib/plan-store";
import { findPlan } from "@/lib/plans";
import { billingState } from "@/lib/subscription";
import { usageForMonth } from "@/lib/usage";

export const dynamic = "force-dynamic";

export default async function OwnerHome({ searchParams }: { searchParams: Promise<{ plan?: string }> }) {
  await requireOwner();
  const { plan: planFilter } = await searchParams;
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const [agencies, usage, unpaid, unresolvedRows, plans] = await Promise.all([
    prisma.agency.findMany({
      orderBy: { name: "asc" },
      where: planFilter ? { plan: planFilter } : undefined,
      include: { _count: { select: { users: { where: { role: { in: ["ADMIN", "AGENT"] }, demo: false } }, artists: true } } },
    }),
    usageForMonth(month),
    prisma.billingStatement.findMany({ where: { status: "ISSUED" } }),
    prisma.booking.groupBy({ by: ["agencyId"], where: unresolvedPastWhere(now), _count: { _all: true } }),
    allPlans(),
  ]);
  const unresolved = new Map(unresolvedRows.map((r) => [r.agencyId, r._count._all]));

  // Revenue is grouped by currency so different currencies are never added together.
  const byCurrency = new Map<string, number>();
  for (const a of agencies) {
    if (a.billingMode === "FREE") continue; // never charged
    const gigs = usage.get(a.id)?.count ?? 0;
    byCurrency.set(a.billingCurrency, (byCurrency.get(a.billingCurrency) ?? 0) + gigs * a.pricePerGigMinor + userCharge(a, a._count.users).monthlyMinor);
  }
  const unpaidByCurrency = new Map<string, number>();
  for (const s of unpaid) unpaidByCurrency.set(s.currency, (unpaidByCurrency.get(s.currency) ?? 0) + s.amountMinor);
  const money = (m: Map<string, number>) => (m.size ? [...m].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, "GBP"));
  const totalGigs = [...usage.values()].reduce((n, u) => n + u.count, 0);

  return (
    <div>
      <PageHeader
        title="Businesses"
        subtitle="Every company using Gigsaw. Each one only sees its own data."
        actions={
          <Link href="/owner/businesses/new" className="btn btn-primary">
            New business
          </Link>
        }
      />
      <div className="mb-10 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active businesses" value={agencies.filter((a) => a.status === "ACTIVE").length} hint={`${agencies.length} in total`} />
        <Stat label={`Billable bookings, ${monthLabel(month)}`} value={totalGigs} hint="So far this month" />
        <Stat label="This month so far" value={money(byCurrency)} hint="At each business's prices" href="/owner/billing" />
        <Stat
          label="Unpaid statements"
          value={money(unpaidByCurrency)}
          hint={`${unpaid.length} statement${unpaid.length === 1 ? "" : "s"}`}
          href="/owner/billing"
        />
      </div>

      {planFilter && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm text-ink-600">
          On the {findPlan(plans, planFilter)?.name ?? planFilter} plan: {agencies.length} business{agencies.length === 1 ? "" : "es"}.
          <Link href="/owner" className="link">
            Show every business
          </Link>
        </p>
      )}
      {agencies.length === 0 ? (
        <Empty>
          No businesses yet.{" "}
          <Link href="/owner/businesses/new" className="link">
            Set up the first one
          </Link>
        </Empty>
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-ink-200 bg-white">
          {agencies.map((a, i) => {
            const gigs = usage.get(a.id)?.count ?? 0;
            const plan =
              a.billingMode === "STRIPE"
                ? `${findPlan(plans, a.plan)?.name ?? a.plan ?? "No plan"} · ${billingState(a).label}`
                : a.billingMode === "FREE"
                  ? "Free account"
                  : `${formatMoney(a.pricePerGigMinor, a.billingCurrency)} per booking`;
            return (
              <li key={a.id} className={i > 0 ? "border-t border-ink-100" : ""}>
                <Link href={`/owner/businesses/${a.id}`} className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-ink-50">
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ink-950 text-xs font-semibold text-volt-300">
                    {a.name
                      .split(/\s+/)
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)
                      .toUpperCase()}
                    <span
                      className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${a.status === "ACTIVE" ? "bg-volt-400" : "bg-cue-500"}`}
                      title={a.status === "ACTIVE" ? "Active" : "Suspended"}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{a.name}</span>
                    <span className="block truncate text-sm text-ink-500">
                      {plan} · {a._count.users} user{a._count.users === 1 ? "" : "s"} · since{" "}
                      {a.createdAt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                      {unresolved.get(a.id) ? <span className="text-amber-700"> · {unresolved.get(a.id)} never confirmed</span> : null}
                    </span>
                  </span>
                  <span className="hidden w-24 text-right sm:block">
                    <span className="block font-mono text-[10px] tracking-[0.12em] text-ink-400 uppercase">Bookings</span>
                    <span className="font-mono text-sm tabular-nums">{gigs}</span>
                  </span>
                  <span className="w-24 text-right">
                    <span className="block font-mono text-[10px] tracking-[0.12em] text-ink-400 uppercase">So far</span>
                    <span className="font-mono text-sm font-semibold tabular-nums">
                      {formatMoney(a.billingMode === "FREE" ? 0 : gigs * a.pricePerGigMinor + userCharge(a, a._count.users).monthlyMinor, a.billingCurrency)}
                    </span>
                  </span>
                  <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-ink-600" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
