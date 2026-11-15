import type { Metadata } from "next";
import Link from "next/link";
import type { ActInvoiceStatus } from "@/lib/act-invoice-rules";
import { invoicesForActLogin } from "@/lib/act-invoices";
import { requireUser } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { ownActIds } from "@/lib/people";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Your invoices" };
export const dynamic = "force-dynamic";

// Worded for the act: "To pay" is how staff see it.
const ACT_LABELS: Record<ActInvoiceStatus, string> = { ISSUED: "Not paid yet", PAID: "Paid", VOID: "Void" };
const STATUS_STYLES: Record<ActInvoiceStatus, string> = {
  ISSUED: "bg-amber-400/15 text-amber-300",
  PAID: "bg-emerald-400/15 text-emerald-300",
  VOID: "bg-white/[0.06] text-ink-400",
};

// The act's self-billing invoices: one per gig, made once it's over, for their own fee. Only what the
// invoice says: never what the venue or customer paid.
export default async function ActInvoices() {
  const user = await requireUser(["ARTIST"]);
  const [invoices, settings, actIds] = await Promise.all([invoicesForActLogin(user), getSettings(user.agencyId), ownActIds(user)]);
  const notReady = actIds.length ? await prisma.artist.count({ where: { id: { in: actIds }, agencyId: user.agencyId, detailsCompletedAt: null } }) : 0;
  const tz = settings.defaultTimezone;
  const sum = (status: string) => invoices.filter((i) => i.status === status).reduce((t, i) => t + i.totalMinor, 0);
  const currency = invoices[0]?.currency ?? settings.defaultCurrency;
  const panel = "rounded-2xl border border-white/[0.06] bg-ink-900";

  return (
    <div className="space-y-5">
      <Link href="/app" className="text-sm text-ink-400 hover:text-white">
        ← All bookings
      </Link>
      <div>
        <h1 className="text-[28px] leading-tight font-semibold tracking-tight">Your invoices</h1>
        <p className="mt-1 text-sm text-ink-400">
          Once a gig&apos;s over, Gigsaw makes out an invoice for your fee on your behalf, so {settings.agencyName} can pay you straight away.
        </p>
      </div>

      {notReady > 0 && (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-200">
          We need your bank details and address before we can make your invoices. Add them, or ask your agent.
        </p>
      )}

      {invoices.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          {[
            ["Waiting to be paid", sum("ISSUED")],
            ["Paid", sum("PAID")],
          ].map(([label, value]) => (
            <div key={label} className={`${panel} p-4`}>
              <div className="text-xs text-ink-400">{label}</div>
              <div className="mt-1 text-xl font-semibold tabular-nums">{formatMoney(Number(value), currency)}</div>
            </div>
          ))}
        </div>
      )}

      {invoices.length === 0 ? (
        <p className={`${panel} p-5 text-sm text-ink-400`}>No invoices yet. Your first one appears here after your next gig.</p>
      ) : (
        <ul className={`${panel} divide-y divide-white/[0.06] overflow-hidden`}>
          {invoices.map((i) => {
            const status = i.status as ActInvoiceStatus;
            return (
              <li key={i.id}>
                <a href={`/print/act-invoices/${i.id}`} target="_blank" className="flex items-center justify-between gap-3 px-4 py-3.5 hover:bg-white/[0.03]">
                  <div className="min-w-0">
                    <div className={`font-medium ${status === "VOID" ? "text-ink-400 line-through" : ""}`}>
                      {i.number} · {formatDate(i.gigDate, tz)}
                    </div>
                    <div className="line-clamp-2 text-sm text-ink-400">{i.description}</div>
                    {status === "PAID" && i.paidAt && <div className="text-xs text-ink-500">Paid {formatDate(i.paidAt, tz)}</div>}
                    {status === "VOID" && i.note && <div className="text-xs text-ink-500">{i.note}</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold tabular-nums">{formatMoney(i.totalMinor, i.currency)}</div>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status] ?? ""}`}>
                      {ACT_LABELS[status] ?? i.status}
                    </span>
                  </div>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
