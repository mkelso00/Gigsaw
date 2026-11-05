import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { saveQuote } from "@/actions/quotes";
import { QuoteEditor } from "@/components/quote-editor";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { EVENT_TYPES, eventTypeLabel } from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { defaultBookingFee, minorToInput } from "@/lib/money";
import { canEdit, quoteRef } from "@/lib/quotes";
import { localDateKey } from "@/lib/time";

export const metadata: Metadata = { title: "Edit proposal" };
export const dynamic = "force-dynamic";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [q, settings, acts, venues] = await Promise.all([
    prisma.quote.findFirst({ where: { id, agencyId: user.agencyId }, include: { lines: { orderBy: { sort: "asc" } }, contact: { select: { name: true } } } }),
    getSettings(user.agencyId),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true, genre: true } }),
    prisma.venue.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true, city: true } }),
  ]);
  if (!q) notFound();
  // Once sent, a quote is changed by making a new version (from its page).
  if (!canEdit(q)) redirect(`/quotes/${q.id}`);
  const cur = q.currency;
  const input = (minor: number | null) => (minor === null ? "" : minorToInput(minor, cur));
  const fee = defaultBookingFee(settings, { eventType: q.eventType });

  return (
    <div className="mx-auto max-w-[1180px]">
      <PageHeader
        eyebrow={
          <>
            <Link href={`/quotes/${q.id}`} className="hover:underline">
              Proposal {quoteRef(q)}
            </Link>
            {q.contact ? ` · for ${q.contact.name}` : ""}
          </>
        }
        title={q.version > 1 ? `Edit version ${q.version}` : "Edit proposal"}
        subtitle="Prices and times are what the customer sees. The act's fee and what you make are only ever shown to your team."
      />
      <QuoteEditor
        action={saveQuote.bind(null, q.id)}
        currency={cur}
        defaultDate={q.lines[0]?.date || localDateKey(new Date(), q.timezone)}
        defaultFee={fee ? minorToInput(fee, cur) : ""}
        acts={acts.map((a) => ({ id: a.id, name: a.name, detail: a.genre || undefined }))}
        venues={venues.map((v) => ({ id: v.id, name: v.name, detail: v.city || undefined }))}
        eventTypes={EVENT_TYPES.map((t) => ({ value: t, label: eventTypeLabel(t) }))}
        values={{
          title: q.title,
          eventType: q.eventType,
          bookingFee: q.bookingFeeMinor ? input(q.bookingFeeMinor) : "",
          deposit: q.depositMinor ? input(q.depositMinor) : "",
          depositDue: q.depositDue ?? "",
          validUntil: q.validUntil ?? "",
          tellActs: q.tellActs,
          message: q.message,
          terms: q.terms,
        }}
        lines={q.lines.map((l) => ({
          artistId: l.artistId ?? "",
          description: l.description,
          date: l.date,
          arriveTime: l.arriveTime,
          startTime: l.startTime,
          endTime: l.endTime,
          venueId: l.venueId ?? "",
          place: l.place,
          sale: l.saleMinor ? input(l.saleMinor) : "",
          cost: input(l.costMinor),
          vatPct: l.vatPct ? String(l.vatPct) : "",
        }))}
      />
    </div>
  );
}
