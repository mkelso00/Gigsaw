import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { quoteRef, quoteTotals, statusLabel, statusStyle, type QuoteLineMoney, type QuoteState } from "@/lib/quotes";
import { formatDate } from "@/lib/time";

// Quotes in a list (the Quotes tab on Enquiries, a customer's page): a status light, what the
// customer pays and what the agency makes, and when it was sent, opened and answered.

export function QuoteStatusBadge({ q, today }: { q: QuoteState; today: string }) {
  return (
    <span className={`badge ${statusStyle(q, today)}`}>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--dot)]" />
      {statusLabel(q, today)}
    </span>
  );
}

export type QuoteRow = QuoteState & {
  id: string;
  number: string;
  version: number;
  title: string;
  currency: string;
  timezone: string;
  bookingFeeMinor: number;
  sentAt: Date | null;
  viewedAt: Date | null;
  answeredAt: Date | null;
  createdAt: Date;
  lines: (QuoteLineMoney & { date: string })[];
  contact?: { id: string; name: string } | null;
};

export function QuoteList({ quotes, today, showCustomer = true }: { quotes: QuoteRow[]; today: string; showCustomer?: boolean }) {
  return (
    <ul className="card divide-y divide-ink-100 overflow-hidden">
      {quotes.map((q) => {
        const t = quoteTotals(q.lines, q.bookingFeeMinor);
        const m = (x: number) => formatMoney(x, q.currency);
        const day = (d: Date) => formatDate(d, q.timezone);
        const first = q.lines
          .map((l) => l.date)
          .filter(Boolean)
          .sort()[0];
        const when = [
          q.sentAt ? `Sent ${day(q.sentAt)}` : `Started ${day(q.createdAt)}`,
          q.viewedAt ? `opened ${day(q.viewedAt)}` : "",
          q.answeredAt ? `${q.status === "ACCEPTED" ? "accepted" : "answered"} ${day(q.answeredAt)}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        return (
          <li key={q.id}>
            <Link
              href={`/quotes/${q.id}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-ink-50 sm:flex-nowrap sm:px-5"
            >
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] tracking-[0.08em] text-ink-500">{quoteRef(q)}</span>
                  <span className="truncate text-sm font-medium text-ink-950">{q.title}</span>
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  {[showCustomer ? q.contact?.name : "", first ? formatDate(new Date(`${first}T12:00:00Z`), "UTC") : "", when].filter(Boolean).join(" · ")}
                </span>
              </span>
              <QuoteStatusBadge q={q} today={today} />
              <span className="w-28 text-right text-sm tabular-nums">
                <span className="block font-medium text-ink-950">{m(t.totalMinor)}</span>
                <span className="block text-xs text-ink-500">makes {m(t.agencyMinor)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export const quoteRowSelect = {
  id: true,
  number: true,
  version: true,
  status: true,
  supersededById: true,
  validUntil: true,
  title: true,
  currency: true,
  timezone: true,
  bookingFeeMinor: true,
  sentAt: true,
  viewedAt: true,
  answeredAt: true,
  createdAt: true,
  enquiryId: true,
  lines: { select: { saleMinor: true, costMinor: true, vatPct: true, date: true }, orderBy: { sort: "asc" } },
  contact: { select: { id: true, name: true } },
} as const;
