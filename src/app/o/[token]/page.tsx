import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OfferButtons } from "@/components/offer-buttons";
import { prisma } from "@/lib/db";
import { dealBreakdown, formatMoney } from "@/lib/money";
import { offerIsBound, offerState, openOffersWhere, type OfferState } from "@/lib/offer-links";
import { formatDate, localTime } from "@/lib/time";

// A gig offer for an act: a private link (no login) to accept or decline. Lists any other open
// offers for the same act too. Shows the act's own fee only. The link only works for the act it
// was sent to: once the booking has moved to another act (or been cancelled) it shows nothing
// about the booking.

export const metadata: Metadata = { title: "Booking offer", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const STATE_LABELS: Record<Exclude<OfferState, "OPEN">, string> = {
  ACCEPTED: "Accepted",
  DECLINED: "Declined",
  CANCELLED: "Cancelled",
  PASSED: "Date passed",
  WITHDRAWN: "No longer offered",
};

/** The page for a link that has done its job, or no longer applies. */
function Closed({ brand, title, text }: { brand?: string; title: string; text: string }) {
  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 text-ink-950">
      <div className="mx-auto max-w-xl">
        {brand && <div className="text-sm font-medium text-ink-500">{brand}</div>}
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-3 text-ink-600">{text}</p>
      </div>
    </div>
  );
}

export default async function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const b = await prisma.booking.findUnique({
    where: { offerToken: token },
    select: {
      agencyId: true,
      artistId: true,
      offeredArtistId: true,
      status: true,
      offerResponse: true,
      setStart: true,
      agency: { include: { settings: true } },
      artist: { select: { name: true } },
    },
  });
  // A link that was replaced (the offer was sent again, or the booking cancelled) or never existed.
  if (!b) return <Closed title="This offer is no longer open" text="If you've had a newer offer message, use the link in that one." />;
  if (b.agency.status !== "ACTIVE") notFound();
  const brand = b.agency.settings?.agencyName || b.agency.name;
  // The booking has moved to another act: nothing about it is shown.
  if (!offerIsBound(b) || !b.artist)
    return <Closed brand={brand} title="This offer is no longer open" text={`${brand} has changed or withdrawn this offer.`} />;

  const now = new Date();
  const mine = offerState(b, now);
  const offers = await prisma.booking.findMany({
    where: {
      agencyId: b.agencyId,
      artistId: b.artistId,
      offeredArtistId: b.artistId,
      OR: [{ offerToken: token }, openOffersWhere(b.agencyId, b.artistId, now)],
    },
    include: { venue: { select: { name: true, city: true, address: true } } },
    orderBy: { arriveBy: "asc" },
  });
  // The gig this link was sent for comes first, then any other open offers.
  offers.sort((x, y) => (x.offerToken === token ? -1 : y.offerToken === token ? 1 : 0));
  const open = offers.filter((o) => offerState(o, now) === "OPEN");
  const title =
    mine === "OPEN"
      ? open.length > 1
        ? `${open.length} booking offers`
        : "Booking offer"
      : mine === "ACCEPTED"
        ? "You've accepted this booking"
        : mine === "DECLINED"
          ? "You've declined this booking"
          : "This offer is no longer open";

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 text-ink-950">
      <div className="mx-auto max-w-xl">
        <div className="text-sm font-medium text-ink-500">{brand}</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-ink-600">For {b.artist.name}</p>
        {mine !== "OPEN" && open.length > 0 && (
          <p className="mt-3 text-ink-600">
            You have {open.length === 1 ? "another offer" : `${open.length} other offers`} from {brand} below.
          </p>
        )}
        <div className="mt-8 space-y-4">
          {offers.map((o) => {
            const fee = dealBreakdown(o).artistMinor;
            const state = offerState(o, now);
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
                  {state !== "OPEN" ? (
                    <p className="rounded-xl bg-ink-100 px-4 py-3 text-sm font-medium text-ink-700">{STATE_LABELS[state]}</p>
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
