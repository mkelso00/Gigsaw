import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OfferButtons } from "@/components/offer-buttons";
import { prisma } from "@/lib/db";
import { dealBreakdown, formatMoney } from "@/lib/money";
import { formatDate, localTime } from "@/lib/time";

// A gig offer for an act: a private link (no login) to accept or decline. Lists any other open
// offers for the same act too. Shows the act's own fee only.

export const metadata: Metadata = { title: "Gig offer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const b = await prisma.booking.findUnique({
    where: { offerToken: token },
    select: { agencyId: true, artistId: true, agency: { include: { settings: true } }, artist: { select: { name: true } } },
  });
  if (!b?.artistId || !b.artist || b.agency.status !== "ACTIVE") notFound();
  const brand = b.agency.settings?.agencyName || b.agency.name;
  const offers = await prisma.booking.findMany({
    where: {
      agencyId: b.agencyId,
      artistId: b.artistId,
      OR: [{ offerToken: token }, { status: "AWAITING", offerResponse: null, offerToken: { not: null }, setStart: { gte: new Date() } }],
    },
    include: { venue: { select: { name: true, city: true, address: true } } },
    orderBy: { arriveBy: "asc" },
  });
  // The gig this link was sent for comes first, then any other open offers.
  offers.sort((x, y) => (x.offerToken === token ? -1 : y.offerToken === token ? 1 : 0));
  const open = offers.filter((o) => o.status === "AWAITING" && !o.offerResponse);

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 text-ink-950">
      <div className="mx-auto max-w-xl">
        <div className="text-sm font-medium text-ink-500">{brand}</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{open.length > 1 ? `${open.length} gig offers` : "Gig offer"}</h1>
        <p className="mt-1 text-ink-600">For {b.artist.name}</p>
        <div className="mt-8 space-y-4">
          {offers.map((o) => {
            const fee = dealBreakdown(o).artistMinor;
            const state =
              o.status === "CANCELLED"
                ? "Cancelled"
                : o.offerResponse === "ACCEPTED" || (o.status !== "AWAITING" && o.status !== "PENDING")
                  ? "Accepted"
                  : o.offerResponse === "DECLINED"
                    ? "Declined"
                    : o.status !== "AWAITING"
                      ? "No longer offered"
                      : null;
            return (
              <section key={o.id} className="card card-pad">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-lg font-semibold">{o.venue?.name ?? "Venue to be confirmed"}</div>
                    <div className="text-sm text-ink-600">{[o.venue?.address, o.venue?.city].filter(Boolean).join(", ")}</div>
                  </div>
                  {fee > 0 && <div className="text-right text-lg font-semibold tabular-nums">{formatMoney(fee, o.currency)}</div>}
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <dt className="text-xs text-ink-500">Date</dt>
                    <dd className="font-medium">{formatDate(o.arriveBy, o.timezone)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-500">Arrive by</dt>
                    <dd className="font-medium tabular-nums">{localTime(o.arriveBy, o.timezone)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-500">On</dt>
                    <dd className="font-medium tabular-nums">
                      {localTime(o.setStart, o.timezone)}
                      {o.setEnd ? `–${localTime(o.setEnd, o.timezone)}` : ""}
                    </dd>
                  </div>
                </dl>
                <div className="mt-4">
                  {state ? (
                    <p className="rounded-xl bg-ink-100 px-4 py-3 text-sm font-medium text-ink-700">{state}</p>
                  ) : (
                    <OfferButtons token={o.offerToken!} all={o.offerToken === token ? open.length : undefined} />
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <p className="mt-8 text-center text-xs text-ink-400">This page is private to you. Questions? Reply to the offer email.</p>
      </div>
    </div>
  );
}
