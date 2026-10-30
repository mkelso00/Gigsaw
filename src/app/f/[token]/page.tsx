import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AvailabilityAnswer } from "@/components/availability-answer";
import { canAnswer, formatRange, requestTimes } from "@/lib/availability";
import { requestPlace, requestToday } from "@/lib/availability-requests";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

// "Are you free?" for an act: a private link (no login) to answer Yes or No, with an optional
// note. Shows the act's own fee only, never what the venue or customer pays.

export const metadata: Metadata = { title: "Are you free?", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function FreePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const reply = await prisma.availabilityReply.findUnique({
    where: { token },
    select: {
      answer: true,
      note: true,
      artist: { select: { name: true } },
      request: {
        select: {
          date: true,
          timezone: true,
          arriveTime: true,
          startTime: true,
          endTime: true,
          place: true,
          costMinor: true,
          currency: true,
          note: true,
          closedAt: true,
          venue: { select: { name: true, city: true, address: true } },
          agency: { select: { name: true, status: true, settings: { select: { agencyName: true } } } },
        },
      },
    },
  });
  if (!reply || reply.request.agency.status !== "ACTIVE") notFound();
  const r = reply.request;
  const brand = r.agency.settings?.agencyName || r.agency.name;
  const open = canAnswer(r, requestToday(r));
  const times = requestTimes(r);
  const place = requestPlace(r);

  return (
    <div className="min-h-screen bg-ink-50 px-4 py-10 text-ink-950">
      <div className="mx-auto max-w-xl">
        <div className="text-sm font-medium text-ink-500">{brand}</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Are you free?</h1>
        <p className="mt-1 text-ink-600">For {reply.artist.name}</p>
        <section className="card card-pad mt-8">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-lg font-semibold">{formatRange(r.date, r.date)}</div>
              {times && <div className="text-sm text-ink-600 tabular-nums">{times.charAt(0).toUpperCase() + times.slice(1)}</div>}
            </div>
            {r.costMinor ? <div className="text-right text-lg font-semibold tabular-nums">{formatMoney(r.costMinor, r.currency)}</div> : null}
          </div>
          {place && (
            <p className="mt-3 text-sm">
              <span className="font-medium">{place}</span>
              {r.venue?.address ? <span className="block text-ink-600">{r.venue.address}</span> : null}
            </p>
          )}
          {r.note && <p className="mt-3 rounded-xl bg-ink-50 px-4 py-3 text-sm whitespace-pre-line text-ink-700">{r.note}</p>}
          <div className="mt-5">
            {open ? (
              <AvailabilityAnswer token={token} answer={reply.answer} note={reply.note} />
            ) : (
              <p className="rounded-xl bg-ink-100 px-4 py-3 text-sm font-medium text-ink-700">
                This question has closed.
                {reply.answer ? ` You said you were ${reply.answer === "YES" ? "free" : "not free"}.` : ""}
              </p>
            )}
          </div>
        </section>
        <p className="mt-8 text-center text-xs text-ink-400">
          This page is private to you. Saying yes isn&apos;t a booking: you&apos;ll hear if they book you.
        </p>
      </div>
    </div>
  );
}
