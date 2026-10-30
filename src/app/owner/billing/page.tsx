import type { Metadata } from "next";
import Link from "next/link";
import { issueStatements, setStatementPaid } from "@/actions/owner";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Empty, PageHeader } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { isMonthKey, monthIsOver, monthLabel, shiftMonth } from "@/lib/billing";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { internalUserCounts } from "@/lib/seat-counts";
import { userCharge } from "@/lib/seats";
import { usageForMonth } from "@/lib/usage";

export const metadata: Metadata = { title: "Billing" };
export const dynamic = "force-dynamic";

export default async function OwnerBillingPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const thisMonth = new Date().toISOString().slice(0, 7);
  // Default to last month: that's the one you bill.
  const month = isMonthKey(sp.month) ? sp.month : shiftMonth(thisMonth, -1);
  const over = monthIsOver(month);

  const [agencies, usage, statements, users] = await Promise.all([
    prisma.agency.findMany({ orderBy: { name: "asc" } }),
    usageForMonth(month),
    prisma.billingStatement.findMany({ where: { month } }),
    internalUserCounts(),
  ]);
  const statementFor = new Map(statements.map((s) => [s.agencyId, s]));
  const rows = agencies
    .map((a) => ({ a, gigs: usage.get(a.id)?.count ?? 0, seats: userCharge(a, users.get(a.id) ?? 0), s: statementFor.get(a.id) }))
    .filter((r) => r.gigs > 0 || r.seats.monthlyMinor > 0 || r.s);

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="What each invoiced business owes for the month: its price per gig for every gig that went ahead, plus any extra internal users. Cancelled gigs, enquiries and demo data are never billed."
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/owner/billing?month=${shiftMonth(month, -1)}`} className="btn" aria-label="Previous month">
              ←
            </Link>
            <span className="min-w-36 text-center font-semibold">{monthLabel(month)}</span>
            <Link href={`/owner/billing?month=${shiftMonth(month, 1)}`} className="btn" aria-label="Next month">
              →
            </Link>
          </div>
        }
      />

      <div className="card card-pad mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="max-w-2xl text-sm text-slate-600">
          {over
            ? "Issuing freezes each business's gig count and price for this month into a statement, with the booking references so the bill can be checked. Re-issuing updates unpaid statements; paid ones are never changed."
            : "This month isn't over yet. The figures below are live and will change as bookings are confirmed or cancelled. You can issue statements once the month ends."}
        </p>
        <div className="flex gap-2">
          <a href={`/api/owner/billing?month=${month}`} className="btn">
            Export CSV
          </a>
          {over && (
            <ActionForm action={issueStatements.bind(null, month)}>
              <SubmitButton pendingText="Issuing…">{statements.length ? "Re-issue statements" : "Issue statements"}</SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <Empty>Nothing to bill for {monthLabel(month)}.</Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Business</th>
                <th className="text-right">Gigs now</th>
                <th className="text-right">Price per gig</th>
                <th className="text-right">Extra users</th>
                <th className="text-right">Amount now</th>
                <th>Statement</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ a, gigs, seats, s }) => (
                <tr key={a.id}>
                  <td>
                    <Link href={`/owner/businesses/${a.id}`} className="link">
                      {a.name}
                    </Link>
                    <div className="text-xs text-slate-500">{a.billingEmail}</div>
                  </td>
                  <td className="text-right">{gigs}</td>
                  <td className="text-right">{formatMoney(a.pricePerGigMinor, a.billingCurrency)}</td>
                  <td className="text-right">{seats.extra ? `${seats.extra} · ${formatMoney(seats.monthlyMinor, a.billingCurrency)}` : "-"}</td>
                  <td className="text-right">{formatMoney(gigs * a.pricePerGigMinor + seats.monthlyMinor, a.billingCurrency)}</td>
                  <td>
                    {s ? (
                      <>
                        <span className={`badge ${s.status === "PAID" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                          {s.status === "PAID" ? "Paid" : "Unpaid"}
                        </span>{" "}
                        <strong>{formatMoney(s.amountMinor, s.currency)}</strong>
                        <span className="text-xs text-slate-500">
                          {" "}
                          for {s.gigCount} gigs{s.extraUsers ? ` + ${s.extraUsers} extra user${s.extraUsers === 1 ? "" : "s"}` : ""}
                        </span>
                        {s.gigCount !== gigs && s.status !== "PAID" && (
                          <div className="text-xs text-amber-700">Bookings changed since issuing. Re-issue to update.</div>
                        )}
                        {s.references && (
                          <details className="mt-1 text-xs text-slate-500">
                            <summary className="cursor-pointer">Booking references</summary>
                            <p className="mt-1 max-w-md break-words">{s.references}</p>
                          </details>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-slate-400">Not issued</span>
                    )}
                  </td>
                  <td className="text-right">
                    {s && (
                      <form action={setStatementPaid.bind(null, s.id, s.status !== "PAID")}>
                        <button className="btn btn-sm">{s.status === "PAID" ? "Mark unpaid" : "Mark paid"}</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
