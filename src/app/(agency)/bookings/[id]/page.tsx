import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addPayment,
  deleteBooking,
  deleteCheckIn,
  deletePayment,
  logCheckInForArtist,
  resendOffer,
  setBookingArchived,
  setBookingStatus,
} from "@/actions/bookings";
import { CopyField } from "@/components/client-bits";
import { CopyBooking } from "@/components/copy-booking";
import { appUrl } from "@/lib/messaging";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { ArrivalPanel } from "@/components/arrival-panel";
import { ArtistDot, DefinitionList, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { arrivalFor } from "@/lib/bookings";
import { buildChecklist } from "@/lib/checklist";
import { linkedActIds } from "@/lib/people";
import {
  BOOKING_STATUSES,
  BOOKING_STATUS_LABELS,
  CHECK_IN_KINDS,
  CHECK_IN_KIND_LABELS,
  DEAL_TYPE_LABELS,
  eventTypeLabel,
  PAYMENT_KINDS,
  PAYMENT_KIND_LABELS,
  type DealType,
  type PaymentKind,
  actName,
} from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { formatDate, formatDateTime, localDateKey, localTime, zoneLabel, formatMinutes } from "@/lib/time";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const user = await requireStaff();
  const b = await prisma.booking.findFirst({ where: { id, agencyId: user.agencyId }, select: { reference: true } });
  return { title: b?.reference ?? "Booking" };
}

export default async function BookingPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [booking, settings] = await Promise.all([
    prisma.booking.findFirst({
      where: { id, agencyId: user.agencyId },
      include: {
        artist: true,
        venue: true,
        promoter: true,
        event: { select: { id: true, name: true } },
        agent: { select: { name: true } },
        payments: { orderBy: { paidAt: "asc" } },
        checkIns: { orderBy: { at: "asc" }, include: { user: { select: { name: true } } } },
      },
    }),
    getSettings(user.agencyId),
  ]);
  if (!booking) notFound();

  const now = new Date();
  const tz = booking.timezone;
  const windowStart = new Date(booking.setStart.getTime() - 400 * 86_400_000);
  const windowEnd = new Date(booking.setStart.getTime() + 400 * 86_400_000);
  const linked = booking.artistId ? await linkedActIds(booking.artistId) : [];
  const [others, activity] = await Promise.all([
    prisma.booking.findMany({
      where: { agencyId: user.agencyId, artistId: { in: linked }, id: { not: booking.id }, setStart: { gte: windowStart, lte: windowEnd } },
      select: {
        id: true,
        reference: true,
        status: true,
        artistId: true,
        artist: { select: { name: true } },
        arriveBy: true,
        setStart: true,
        setEnd: true,
        radiusKm: true,
        radiusDays: true,
        venue: { select: { name: true, latitude: true, longitude: true } },
      },
    }),
    prisma.activity.findMany({
      where: { agencyId: user.agencyId, entity: "BOOKING", entityId: booking.id },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { user: { select: { name: true } } },
    }),
  ]);

  const deal = dealBreakdown(booking);
  const totals = paymentTotals(booking.payments);
  const checklist = buildChecklist(
    { ...booking, linkedArtistIds: linked },
    others.map((o) => ({ ...o, artistName: actName(o) })),
    totals.depositReceivedMinor,
    now,
    settings.changeoverMinutes,
  );
  const arrival = arrivalFor(booking, settings, now);
  const money = (m: number) => formatMoney(m, booking.currency);
  // Bar gigs are paid by the venue; weddings and parties by the client.
  const payerShort = booking.eventType === "GIG" && booking.venue ? "Venue" : "Client";
  const payerLabel = `${payerShort} pays`;
  const zone = zoneLabel(booking.arriveBy, tz);

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <ArtistDot colour={booking.artist?.colour ?? "#a2a199"} />
              {actName(booking)}
            </span>
            <StatusBadge status={booking.status} />
          </span>
        }
        subtitle={
          <>
            {booking.reference} · {eventTypeLabel(booking.eventType)} · {formatDate(booking.arriveBy, tz)}
            {booking.venue ? ` · ${booking.venue.name}${booking.venue.city ? `, ${booking.venue.city}` : ""}` : ""}
            {booking.event ? (
              <>
                {" · "}
                <Link href={`/events/${booking.event.id}`} className="link">
                  Part of {booking.event.name}
                </Link>
              </>
            ) : booking.eventName ? (
              ` · ${booking.eventName}`
            ) : (
              ""
            )}
          </>
        }
        actions={
          <>
            <Link href={`/bookings/${booking.id}/edit`} className="btn">
              Edit
            </Link>
            <CopyBooking
              bookingId={booking.id}
              startDate={localDateKey(booking.arriveBy, tz)}
              today={localDateKey(new Date(), tz)}
              hasAct={!!booking.artistId}
              actName={actName(booking)}
            />
            <a href={`/print/bookings/${booking.id}/contract`} target="_blank" className="btn">
              Contract
            </a>
            <a href={`/print/bookings/${booking.id}/invoice`} target="_blank" className="btn">
              Invoice
            </a>
            <a href={`/print/bookings/${booking.id}/itinerary`} target="_blank" className="btn">
              Itinerary
            </a>
            <form action={setBookingArchived.bind(null, booking.id, !booking.archivedAt)}>
              <button className="btn">{booking.archivedAt ? "Restore" : "Archive"}</button>
            </form>
          </>
        }
      />

      {booking.archivedAt && (
        <div className="mb-6 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <strong>Archived</strong> on {formatDate(booking.archivedAt, tz)}. It isn&apos;t in your lists, calendar or reports, and the act doesn&apos;t see it.
          Press Restore to bring it back.
        </div>
      )}
      {arrival.state === "OVERDUE" && !booking.archivedAt && (
        <div
          role="alert"
          className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl bg-rose-600 px-6 py-5 text-white shadow-lg shadow-rose-900/20"
        >
          <span className="relative flex h-4 w-4 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#fff] opacity-60" />
            <span className="relative inline-flex h-4 w-4 rounded-full bg-[#fff]" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-2xl font-bold tracking-tight">Overdue{arrival.minutesOverdue ? `: ${formatMinutes(arrival.minutesOverdue)} late` : ""}</div>
            <div className="mt-0.5 text-[15px] text-white/90">
              {actName(booking)} hasn&apos;t checked in. Call time was {localTime(booking.arriveBy, tz)}
              {arrival.expectedAt ? `; they said they'd arrive at ${localTime(arrival.expectedAt, tz)}` : ""}.
            </div>
          </div>
          {booking.artist?.phone && (
            <a
              href={`tel:${booking.artist.phone.replace(/\s/g, "")}`}
              className="btn h-12 border-[#fff] bg-[#fff] px-6 text-base font-semibold text-[#be123c] hover:bg-[#fff1f2]"
            >
              Call {booking.artist.phone}
            </a>
          )}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <ArrivalPanel booking={booking} arrival={arrival} settings={settings} />

          <section className="card card-pad">
            <h2 className="section-title mb-4">Log a check-in for the act</h2>
            <p className="mb-4 text-sm text-slate-500">
              Use this if the act can&apos;t use the app, for example the venue rang to say they&apos;re in. Leave the time blank for now. It is marked as logged by you.
            </p>
            <ActionForm action={logCheckInForArtist.bind(null, booking.id)} className="grid gap-3 sm:grid-cols-5 sm:items-end">
              <Field label="Type">
                <select name="kind" className="input" defaultValue="ARRIVED">
                  {CHECK_IN_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {CHECK_IN_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" name="date" defaultValue={localDateKey(now, tz)} className="input" />
              </Field>
              <Field label={`Time (${zone})`}>
                <input type="time" name="time" className="input" />
              </Field>
              <Field label="Note">
                <input name="note" className="input" placeholder="Optional" />
              </Field>
              <SubmitButton>Log it</SubmitButton>
            </ActionForm>
            {booking.checkIns.length > 0 && (
              <ul className="mt-5 divide-y divide-slate-100 border-t border-slate-100 text-sm">
                {booking.checkIns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                    <span>
                      <strong>{CHECK_IN_KIND_LABELS[c.kind as keyof typeof CHECK_IN_KIND_LABELS] ?? c.kind}</strong> at {formatDateTime(c.at, tz)}{" "}
                      {c.source === "AGENT" ? `· logged by ${c.user?.name ?? "agency"}` : "· from the artist app"}
                      {c.note && <span className="text-slate-500"> · “{c.note}”</span>}
                    </span>
                    <form action={deleteCheckIn.bind(null, c.id)}>
                      <ConfirmButton message="Remove this check-in?" className="btn btn-sm btn-danger">
                        Remove
                      </ConfirmButton>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-4">Schedule ({zone})</h2>
            <DefinitionList
              items={[
                ["Arrive by", formatDateTime(booking.arriveBy, tz)],
                ["Soundcheck", booking.soundcheckAt ? localTime(booking.soundcheckAt, tz) : ""],
                ["On stage", formatDateTime(booking.setStart, tz)],
                ["Off stage", booking.setEnd ? formatDateTime(booking.setEnd, tz) : ""],
              ]}
            />
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-4">Details</h2>
            <DefinitionList
              items={[
                [
                  "Venue",
                  booking.venue ? (
                    <Link href={`/venues/${booking.venue.id}`} className="link">
                      {booking.venue.name}
                    </Link>
                  ) : (
                    ""
                  ),
                ],
                [
                  "Who pays",
                  booking.promoter ? (
                    <Link href={`/contacts/${booking.promoter.id}`} className="link">
                      {booking.promoter.name}
                      {booking.promoter.company ? ` (${booking.promoter.company})` : ""}
                    </Link>
                  ) : (
                    ""
                  ),
                ],
                ["Booking type", eventTypeLabel(booking.eventType)],
                ["Lead agent", booking.agent?.name ?? ""],
                ["Tags", booking.tags],
                ["Travel", booking.travel],
                ["Accommodation", booking.accommodation],
                ["Day of show contact", booking.dayContact],
                ["Hospitality", booking.hospitality],
                ["Internal notes", booking.notes],
                ["Radius clause", booking.radiusKm !== null ? `${booking.radiusKm} km, ${booking.radiusDays} days either side` : ""],
              ]}
            />
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-4">Payments</h2>
            {booking.payments.length > 0 && (
              <table className="table mb-5">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Note</th>
                    <th className="text-right">Amount</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {booking.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="whitespace-nowrap">{formatDate(p.paidAt, tz)}</td>
                      <td>
                        {p.direction === "IN" ? "Received" : "Paid out"} · {PAYMENT_KIND_LABELS[p.kind as PaymentKind] ?? p.kind}
                      </td>
                      <td className="text-slate-500">{p.note}</td>
                      <td className={`text-right whitespace-nowrap ${p.direction === "IN" ? "text-emerald-700" : "text-rose-700"}`}>
                        {p.direction === "IN" ? "+" : "−"}
                        {money(p.amountMinor)}
                      </td>
                      <td className="text-right">
                        <form action={deletePayment.bind(null, p.id)}>
                          <ConfirmButton message="Remove this payment?" className="btn btn-sm btn-danger">
                            Remove
                          </ConfirmButton>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ActionForm action={addPayment.bind(null, booking.id)} className="grid gap-3 sm:grid-cols-6 sm:items-end">
              <Field label="Direction">
                <select name="direction" className="input">
                  <option value="IN">Received</option>
                  <option value="OUT">Paid out</option>
                </select>
              </Field>
              <Field label="Type">
                <select name="kind" className="input">
                  {PAYMENT_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PAYMENT_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={`Amount (${booking.currency})`}>
                <input name="amount" inputMode="decimal" required className="input" />
              </Field>
              <Field label="Date">
                <input type="date" name="paidAt" defaultValue={localDateKey(now, tz)} className="input" />
              </Field>
              <Field label="Note">
                <input name="note" className="input" />
              </Field>
              <SubmitButton>Add payment</SubmitButton>
            </ActionForm>
          </section>
        </div>

        <div className="space-y-6">
          <section className="card card-pad">
            <h2 className="section-title mb-3">Status</h2>
            <ActionForm action={setBookingStatus.bind(null, booking.id)} className="flex flex-wrap gap-2">
              <select name="status" defaultValue={booking.status} className="input min-w-0 flex-1">
                {BOOKING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {BOOKING_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn">Update</SubmitButton>
            </ActionForm>
            <p className="hint">Pending → Awaiting confirmation (the act is offered the gig) → Confirmed when they accept.</p>
            {booking.customerToldAt && (
              <p className="mt-2 text-xs font-medium text-emerald-700">Customer told it&apos;s confirmed, {formatDateTime(booking.customerToldAt, tz)}</p>
            )}
            {booking.artistId && (booking.status === "AWAITING" || booking.offerResponse) && (
              <div className="mt-4 border-t border-ink-100 pt-4 text-sm">
                <div className="font-medium">
                  {booking.offerResponse === "ACCEPTED"
                    ? "Accepted by the act"
                    : booking.offerResponse === "DECLINED"
                      ? "Declined by the act"
                      : booking.offeredAt
                        ? "Waiting for the act to answer"
                        : "Offer not sent yet"}
                </div>
                <div className={`text-xs ${booking.offerResponse === "DECLINED" ? "font-medium text-rose-700" : "text-ink-500"}`}>
                  {booking.respondedAt ? formatDateTime(booking.respondedAt, tz) : booking.offeredAt ? `Offered ${formatDateTime(booking.offeredAt, tz)}` : ""}
                </div>
                {booking.offerToken && booking.status === "AWAITING" && (
                  <div className="mt-3">
                    <CopyField value={`${appUrl()}/o/${booking.offerToken}`} />
                  </div>
                )}
                {booking.status === "AWAITING" && (
                  <ActionForm action={resendOffer.bind(null, booking.id)} className="mt-2">
                    <SubmitButton className="btn w-full" pendingText="Sending…">
                      {booking.offeredAt ? "Send the offer again" : "Send the offer"}
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            )}
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-3">Checklist</h2>
            <ul className="space-y-2 text-sm">
              {checklist.map((c) => (
                <li key={c.label} className="flex gap-2">
                  <span
                    className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                      c.level === "ok" ? "bg-emerald-500" : c.level === "warning" ? "bg-amber-500" : "bg-rose-600"
                    }`}
                  >
                    {c.level === "ok" ? "✓" : "!"}
                  </span>
                  <span>
                    {c.label}
                    {c.detail && <span className="block text-xs text-slate-500">{c.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-3">Money</h2>
            <dl className="space-y-2 text-sm">
              {booking.dealType !== "BUY_SELL" && <Row label="Deal">{DEAL_TYPE_LABELS[booking.dealType as DealType] ?? booking.dealType}</Row>}
              <Row label={payerLabel}>
                {money(deal.grossMinor)}
                {deal.vatMinor > 0 && (
                  <span className="block text-xs text-slate-500">
                    + {money(deal.vatMinor)} VAT ({booking.vatPct}%)
                  </span>
                )}
              </Row>
              {deal.bookingFeeMinor > 0 && (
                <Row label="Booking fee">
                  {money(deal.bookingFeeMinor)}
                  <span className="block text-xs text-slate-500">on top, all ours</span>
                </Row>
              )}
              <Row label="Act is paid">
                {booking.dealType === "BUY_SELL" && booking.artistFeeMinor === null ? <span className="text-amber-500">Not set</span> : money(deal.artistMinor)}
              </Row>
              <Row label="We make">
                <strong className={deal.agencyMinor < 0 ? "text-rose-500" : "text-emerald-500"}>{money(deal.agencyMinor)}</strong>
              </Row>
              <hr className="border-slate-100" />
              {booking.depositMinor > 0 && (
                <Row label="Deposit">
                  {money(totals.depositReceivedMinor)} of {money(booking.depositMinor)}
                  {booking.depositDueDate && <span className="block text-xs text-slate-500">due {formatDate(booking.depositDueDate, tz)}</span>}
                </Row>
              )}
              <Row label={`${payerShort} has paid`}>
                {money(totals.receivedMinor)} of {money(deal.totalDueMinor)}
              </Row>
              <Row label={`${payerShort} still owes`}>
                <strong>{money(Math.max(0, deal.totalDueMinor - totals.receivedMinor))}</strong>
              </Row>
              <Row label="Paid to act">
                {money(totals.paidOutMinor)} of {money(deal.artistMinor)}
              </Row>
              <Row label="Still to pay act">
                <strong>{money(Math.max(0, deal.artistMinor - totals.paidOutMinor))}</strong>
              </Row>
            </dl>
            {booking.dealNotes && <p className="mt-3 text-xs whitespace-pre-line text-slate-500">{booking.dealNotes}</p>}
          </section>

          <section className="card card-pad">
            <h2 className="section-title mb-3">Activity</h2>
            {activity.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {activity.map((a) => (
                  <li key={a.id}>
                    <span className="font-medium">{a.user?.name ?? "Someone"}</span> {a.action}
                    {a.detail && <span className="text-slate-500"> · {a.detail}</span>}
                    <span className="block text-xs text-slate-400">{formatDateTime(a.createdAt, settings.defaultTimezone)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {booking.archivedAt ? (
            user.role === "ADMIN" && (
              <form action={deleteBooking.bind(null, booking.id)}>
                <ConfirmButton message={`Delete ${booking.reference} for good? This removes its payments and check-ins too.`} className="btn btn-danger w-full">
                  Delete for good
                </ConfirmButton>
              </form>
            )
          ) : (
            <form action={setBookingArchived.bind(null, booking.id, true)}>
              <ConfirmButton
                message={`Archive ${booking.reference}? It leaves your lists and calendar. You can restore it from Archived.`}
                className="btn w-full"
              >
                Archive booking
              </ConfirmButton>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
