import Link from "next/link";
import { Empty, PageHeader, Stat } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { monthLabel, unresolvedPastWhere } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { usageForMonth } from "@/lib/usage";

export const dynamic = "force-dynamic";

export default async function OwnerHome() {
  await requireOwner();
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  const [agencies, usage, unpaid, unresolvedRows] = await Promise.all([
    prisma.agency.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: { where: { role: { in: ["ADMIN", "AGENT"] }, demo: false } }, artists: true } } },
    }),
    usageForMonth(month),
    prisma.billingStatement.findMany({ where: { status: "ISSUED" } }),
    prisma.booking.groupBy({ by: ["agencyId"], where: unresolvedPastWhere(now), _count: { _all: true } }),
  ]);
  const unresolved = new Map(unresolvedRows.map((r) => [r.agencyId, r._count._all]));

  // Revenue is grouped by currency so different currencies are never added together.
  const byCurrency = new Map<string, number>();
  for (const a of agencies) {
    const gigs = usage.get(a.id)?.count ?? 0;
    byCurrency.set(a.billingCurrency, (byCurrency.get(a.billingCurrency) ?? 0) + gigs * a.pricePerGigMinor);
  }
  const unpaidByCurrency = new Map<string, number>();
  for (const s of unpaid) unpaidByCurrency.set(s.currency, (unpaidByCurrency.get(s.currency) ?? 0) + s.amountMinor);
  const money = (m: Map<string, number>) => (m.size ? [...m].map(([c, v]) => formatMoney(v, c)).join(" + ") : formatMoney(0, "GBP"));
  const totalGigs = [...usage.values()].reduce((n, u) => n + u.count, 0);

  return (
    <div>
      <PageHeader
        title="Agencies"
        subtitle="Every company using Gigsaw. Each one only sees its own data."
        actions={
          <Link href="/owner/agencies/new" className="btn btn-primary">
            New agency
          </Link>
        }
      />
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active agencies" value={agencies.filter((a) => a.status === "ACTIVE").length} hint={`${agencies.length} in total`} />
        <Stat label={`Billable gigs, ${monthLabel(month)}`} value={totalGigs} hint="So far this month" />
        <Stat label="This month so far" value={money(byCurrency)} hint="At each agency's price per gig" href="/owner/billing" />
        <Stat label="Unpaid statements" value={money(unpaidByCurrency)} hint={`${unpaid.length} statement(s)`} href="/owner/billing" />
      </div>

      {agencies.length === 0 ? (
        <Empty>
          No agencies yet. <Link href="/owner/agencies/new" className="link">Set up the first one</Link>
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Agency</th>
                <th>Status</th>
                <th className="text-right">Team</th>
                <th className="text-right">Acts</th>
                <th className="text-right">Price per gig</th>
                <th className="text-right">Gigs this month</th>
                <th className="text-right">Bill so far</th>
                <th className="text-right">Never confirmed</th>
              </tr>
            </thead>
            <tbody>
              {agencies.map((a) => {
                const gigs = usage.get(a.id)?.count ?? 0;
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td>
                      <Link href={`/owner/agencies/${a.id}`} className="link">
                        {a.name}
                      </Link>
                      <div className="text-xs text-slate-500">Since {a.createdAt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}</div>
                    </td>
                    <td>
                      <span className={`badge ${a.status === "ACTIVE" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"}`}>
                        {a.status === "ACTIVE" ? "Active" : "Suspended"}
                      </span>
                    </td>
                    <td className="text-right">{a._count.users}</td>
                    <td className="text-right">{a._count.artists}</td>
                    <td className="text-right">{formatMoney(a.pricePerGigMinor, a.billingCurrency)}</td>
                    <td className="text-right">{gigs}</td>
                    <td className="text-right font-medium">{formatMoney(gigs * a.pricePerGigMinor, a.billingCurrency)}</td>
                    <td className="text-right">
                      {unresolved.get(a.id) ? (
                        <span className="badge bg-amber-50 text-amber-800" title="Past gigs still on enquiry, hold or pending">
                          {unresolved.get(a.id)}
                        </span>
                      ) : (
                        <span className="text-ink-300">0</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
