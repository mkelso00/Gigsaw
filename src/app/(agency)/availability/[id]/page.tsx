import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { askMoreActs, bookFromReply, remindAvailability, setRequestClosed } from "@/actions/availability";
import { ActPicker } from "@/components/act-picker";
import { AutoRefresh, CopyField } from "@/components/client-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ArtistDot, PageHeader, Stat } from "@/components/ui";
import { ACT_TYPE_LABELS } from "@/lib/act-profile";
import { requireStaff } from "@/lib/auth";
import { actHintsOn } from "@/lib/away";
import { canAnswer, formatRange, replyCounts, requestTimes, sortReplies } from "@/lib/availability";
import { requestPlace, requestToday } from "@/lib/availability-requests";
import { eventTypeLabel } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { appUrl } from "@/lib/messaging";
import { formatMoney, minorToInput } from "@/lib/money";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Who's free" };

export default async function AvailabilityRequestPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const r = await prisma.availabilityRequest.findFirst({
    where: { id, agencyId: user.agencyId },
    include: {
      venue: { select: { id: true, name: true, city: true } },
      booking: { select: { id: true, reference: true, artistId: true, status: true } },
      replies: { include: { artist: { select: { id: true, name: true, colour: true, phone: true } }, booking: { select: { id: true, reference: true } } } },
    },
  });
  if (!r) notFound();
  const open = canAnswer(r, requestToday(r));
  const asked = new Set(r.replies.map((x) => x.artistId));
  const [hints, others] = await Promise.all([
    actHintsOn(user.agencyId, r.date, r.timezone),
    open
      ? prisma.artist.findMany({
          where: { agencyId: user.agencyId, id: { notIn: [...asked] } },
          orderBy: { name: "asc" },
          select: { id: true, name: true, actType: true, town: true },
        })
      : [],
  ]);
  const c = replyCounts(r.replies);
  const replies = sortReplies(r.replies);
  const where = requestPlace(r);
  const times = requestTimes(r);
  // A Yes fills the gig this was asked for while it still has no act; otherwise it makes a new booking.
  const fillGig = r.booking && !r.booking.artistId && r.booking.status !== "CANCELLED" ? r.booking : null;
  const sent = sp.sent !== undefined ? Number(sp.sent) : null;
  const fullForm = (artistId: string) =>
    `/bookings/new?${new URLSearchParams(
      Object.entries({
        artistId,
        date: r.date,
        venueId: r.venue?.id,
        arriveTime: r.arriveTime || r.startTime,
        setStartTime: r.startTime,
        setEndTime: r.endTime,
        eventType: r.eventType,
        cost: minorToInput(r.costMinor, r.currency),
      }).filter((e): e is [string, string] => !!e[1]),
    )}`;

  return (
    <div>
      <PageHeader
        eyebrow={
          <Link href="/availability" className="hover:underline">
            Who&apos;s free
          </Link>
        }
        title={formatRange(r.date, r.date)}
        actions={
          <>
            {r.booking && (
              <Link href={`/bookings/${r.booking.id}`} className="btn">
                Gig {r.booking.reference}
              </Link>
            )}
            {open && c.waiting > 0 && (
              <ActionForm action={remindAvailability.bind(null, r.id)}>
                <SubmitButton className="btn" pendingText="Sending…">
                  Ask again ({c.waiting})
                </SubmitButton>
              </ActionForm>
            )}
            <form action={setRequestClosed.bind(null, r.id, !r.closedAt)}>
              <button className="btn">{r.closedAt ? "Reopen" : "Close"}</button>
            </form>
          </>
        }
      />

      {sent !== null && !Number.isNaN(sent) && (
        <div
          role="status"
          className={`mb-6 rounded-xl border px-4 py-3 text-sm ${sent ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-300 bg-amber-50 text-amber-900"}`}
        >
          {sent
            ? `Sent. ${sent} ${sent === 1 ? "person was" : "people were"} asked. Answers show here as they come in.`
            : "Saved, but nobody could be messaged (no email, phone or login on file, demo acts, or the message is switched off). Copy each act's link below and send it yourself."}
        </div>
      )}
      {/* What the acts were asked, shown on phones too (the page subtitle isn't). */}
      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm sm:flex sm:flex-wrap">
        {(
          [
            ["Where", where || "Not given"],
            ["Times", times || "Not given"],
            ["Type", eventTypeLabel(r.eventType)],
            ["Act's fee", r.costMinor ? formatMoney(r.costMinor, r.currency) : "Not given"],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-xs text-ink-500">{k}</dt>
            <dd className="truncate font-medium">{v}</dd>
          </div>
        ))}
        {r.note && (
          <div className="col-span-2 min-w-0 sm:basis-full">
            <dt className="text-xs text-ink-500">Note for the acts</dt>
            <dd className="whitespace-pre-line">{r.note}</dd>
          </div>
        )}
      </dl>

      <div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="Free" value={c.yes} />
        <Stat label="Waiting" value={c.waiting} />
        <Stat label="Not free" value={c.no} />
      </div>

      <section className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="section-title">Answers</h2>
          {open ? (
            <AutoRefresh seconds={10} />
          ) : (
            <span className="text-xs text-ink-500">{r.closedAt ? "Closed: acts can't answer now." : "This date has passed."}</span>
          )}
        </div>
        <ul className="card divide-y divide-ink-100">
          {replies.map((x) => {
            const hint = hints.get(x.artistId);
            const busy = hint && !x.booking ? hint : null;
            return (
              <li key={x.id} className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex flex-wrap items-center gap-2">
                    <ArtistDot colour={x.artist.colour} />
                    <Link href={`/artists/${x.artist.id}`} className="font-medium hover:underline">
                      {x.artist.name}
                    </Link>
                    <span
                      className={`badge ${x.answer === "YES" ? "bg-emerald-100 text-emerald-800" : x.answer === "NO" ? "bg-rose-50 text-rose-800" : "bg-ink-100 text-ink-600"}`}
                    >
                      {x.answer === "YES" ? "Free" : x.answer === "NO" ? "Not free" : "Waiting"}
                    </span>
                    {busy && <span className={`badge ${busy.tone === "away" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}`}>{busy.hint}</span>}
                  </div>
                  {x.note && <p className="mt-1 text-sm text-ink-700">“{x.note}”</p>}
                  <p className="mt-0.5 text-xs text-ink-500">
                    {x.answeredAt
                      ? `Answered ${formatDateTime(x.answeredAt, r.timezone)}`
                      : x.sentAt
                        ? `Asked ${formatDateTime(x.sentAt, r.timezone)}`
                        : "Not messaged: send them the link"}
                    {x.artist.phone && (
                      <>
                        {" · "}
                        <a href={`tel:${x.artist.phone.replace(/\s/g, "")}`} className="link">
                          {x.artist.phone}
                        </a>
                      </>
                    )}
                  </p>
                  {!x.answer && open && (
                    <details className="mt-2 text-sm">
                      <summary className="cursor-pointer text-xs text-ink-500">Their link</summary>
                      <div className="mt-2 max-w-md">
                        <CopyField value={`${appUrl()}/f/${x.token}`} />
                      </div>
                    </details>
                  )}
                </div>
                {x.answer === "YES" && (
                  <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                    {x.booking ? (
                      <Link href={`/bookings/${x.booking.id}`} className="btn btn-sm">
                        Booked: {x.booking.reference}
                      </Link>
                    ) : (
                      <>
                        {(fillGig || r.startTime) && (
                          <ActionForm action={bookFromReply.bind(null, x.id)} className="contents">
                            <SubmitButton className="btn btn-sm btn-primary" pendingText="Booking…">
                              {fillGig ? `Put on ${fillGig.reference}` : "Book (Pending)"}
                            </SubmitButton>
                          </ActionForm>
                        )}
                        {!fillGig && (
                          <Link href={fullForm(x.artistId)} className="btn btn-sm">
                            Full form
                          </Link>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {c.yes > 0 && !fillGig && !r.startTime && (
          <p className="mt-2 text-xs text-ink-500">No times were given, so Full form opens a new booking with the act, date and place filled in.</p>
        )}
      </section>

      {open && others.length > 0 && (
        <section className="card card-pad">
          <h2 className="section-title">Ask more acts</h2>
          <p className="mt-1 mb-4 text-sm text-ink-500">They&apos;re sent the same question.</p>
          <ActionForm action={askMoreActs.bind(null, r.id)} className="space-y-3">
            <ActPicker
              acts={others.map((a) => {
                const h = hints.get(a.id);
                return {
                  id: a.id,
                  name: a.name,
                  detail: [ACT_TYPE_LABELS[a.actType as keyof typeof ACT_TYPE_LABELS], a.town].filter(Boolean).join(" · "),
                  hint: h?.hint,
                  tone: h?.tone,
                };
              })}
            />
            <SubmitButton className="btn btn-primary w-full sm:w-auto" pendingText="Sending…">
              Ask them
            </SubmitButton>
          </ActionForm>
        </section>
      )}
    </div>
  );
}
