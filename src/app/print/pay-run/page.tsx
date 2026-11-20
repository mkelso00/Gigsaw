import type { Metadata } from "next";
import { DocumentShell } from "@/components/document";
import { formatSortCode } from "@/lib/act-invoice-rules";
import { requireAdmin } from "@/lib/auth";
import { getSettings } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { lastWeekStart, progressLine, readWeek, weekLabel, weekShort } from "@/lib/pay-run";
import { payRunWeek } from "@/lib/pay-run-server";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Payment list" };

// The weekly pay run's payment list on paper: one line per payee with their bank details, the amount and the
// reference, and a box to tick as each transfer goes. Admins only, as it has whole account numbers.
export default async function PayRunPrint({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const user = await requireAdmin();
  const settings = await getSettings(user.agencyId);
  const tz = settings.defaultTimezone;
  const week = readWeek((await searchParams).week) ?? lastWeekStart(new Date(), tz);
  const v = await payRunWeek(user.agencyId, week, { timeZone: tz, business: settings.agencyName });
  const currency = v.invoices[0]?.currency ?? settings.defaultCurrency;
  const m = (x: number) => formatMoney(x, currency);
  const toPay = v.payees.filter((p) => !p.paid);
  const paid = v.payees.filter((p) => p.paid);

  return (
    <DocumentShell title="Payment list" reference={weekShort(week)} settings={settings}>
      <p className="mb-1 text-sm text-slate-600">
        Act invoices for the gigs from {weekLabel(week)}. {progressLine(v.progress, currency)}.
      </p>
      <p className="mb-6 text-sm font-semibold">
        To pay: {m(v.progress.owedMinor)} to {toPay.length} payee{toPay.length === 1 ? "" : "s"}
      </p>
      {v.payees.length === 0 ? (
        <p className="text-sm text-slate-500">No act invoices for gigs in this week.</p>
      ) : (
        <table className="w-full text-xs" data-testid="payment-list">
          <thead>
            <tr className="border-b-2 border-slate-300 text-left">
              <th className="w-6 py-1.5" aria-label="Done" />
              <th className="py-1.5 pr-2">Payee</th>
              <th className="py-1.5 pr-2">Account name</th>
              <th className="py-1.5 pr-2">Sort code</th>
              <th className="py-1.5 pr-2">Account</th>
              <th className="py-1.5 pr-2 text-right">Amount</th>
              <th className="py-1.5">Reference</th>
            </tr>
          </thead>
          <tbody>
            {[...toPay, ...paid].map((p) => (
              <tr key={p.key} className={`border-b border-slate-100 align-top ${p.paid ? "text-slate-400" : ""}`}>
                <td className="py-1.5">
                  <span className="inline-block h-3.5 w-3.5 rounded-sm border border-slate-400 text-center leading-3">{p.paid ? "✓" : ""}</span>
                </td>
                <td className="py-1.5 pr-2">
                  <div className="font-medium">{p.name}</div>
                  {(p.acts.length > 1 || p.acts[0] !== p.name) && <div className="text-slate-500">{p.acts.join(", ")}</div>}
                  {p.paid && p.paidAt && <div>Paid {formatDate(p.paidAt, tz)}</div>}
                </td>
                <td className="py-1.5 pr-2">{p.bank.accountName}</td>
                <td className="py-1.5 pr-2 font-mono whitespace-nowrap">{p.bank.sortCode ? formatSortCode(p.bank.sortCode) : ""}</td>
                <td className="py-1.5 pr-2 font-mono">{p.bank.accountNumber}</td>
                <td className="py-1.5 pr-2 text-right font-semibold whitespace-nowrap tabular-nums">{m(p.paid ? p.totalMinor : p.owedMinor)}</td>
                <td className="py-1.5 font-mono">{p.reference}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 font-semibold">
              <td />
              <td className="py-2" colSpan={4}>
                Still to pay
              </td>
              <td className="py-2 pr-2 text-right tabular-nums">{m(v.progress.owedMinor)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      )}
    </DocumentShell>
  );
}
