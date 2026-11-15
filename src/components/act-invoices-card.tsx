import Link from "next/link";
import { INVOICE_STATUS_LABELS, detailsMissing, type ActInvoiceStatus } from "@/lib/act-invoice-rules";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/time";

/** The act's self-billing invoices on their page, newest first, and whether invoices can be made for them yet. */
export async function ActInvoicesCard({ artistId, agencyId, timeZone }: { artistId: string; agencyId: string; timeZone: string }) {
  const [act, invoices, toPay] = await Promise.all([
    prisma.artist.findFirst({ where: { id: artistId, agencyId } }),
    prisma.actInvoice.findMany({ where: { artistId, agencyId }, orderBy: { seq: "desc" }, take: 6 }),
    prisma.actInvoice.aggregate({ where: { artistId, agencyId, status: "ISSUED" }, _sum: { totalMinor: true }, _count: true }),
  ]);
  if (!act) return null;
  const missing = detailsMissing(act);
  return (
    <section className="card card-pad" aria-label="Invoices">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="section-title">Invoices</h2>
        <Link href={`/payments/acts?act=${artistId}`} className="link text-sm">
          Pay acts
        </Link>
      </div>
      {missing ? (
        <p className="mt-2 text-sm font-medium text-amber-700">{missing}. Invoices are made once they&apos;re in.</p>
      ) : (
        <p className="mt-1 text-sm text-ink-500">Made for their fee once each gig is over.</p>
      )}
      {toPay._count > 0 && (
        <p className="mt-2 text-sm">
          {toPay._count} to pay: <span className="font-semibold">{formatMoney(toPay._sum.totalMinor ?? 0, invoices[0]?.currency)}</span>
        </p>
      )}
      {invoices.length > 0 && (
        <ul className="mt-3 divide-y divide-ink-100 text-sm">
          {invoices.map((i) => (
            <li key={i.id} className="flex items-center justify-between gap-3 py-2">
              <a href={`/print/act-invoices/${i.id}`} target="_blank" className="min-w-0 hover:underline">
                {i.number} <span className="text-ink-500">· {formatDate(i.gigDate, timeZone)}</span>
              </a>
              <span className="shrink-0 tabular-nums">
                {formatMoney(i.totalMinor, i.currency)}{" "}
                <span className="text-xs text-ink-500">{INVOICE_STATUS_LABELS[i.status as ActInvoiceStatus] ?? i.status}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
