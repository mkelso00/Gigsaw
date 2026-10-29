import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addPayment,
  deleteBooking,
  deleteCheckIn,
  deletePayment,
  logCheckInForArtist,
  setBookingStatus,
} from "@/actions/bookings";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { ArrivalPanel } from "@/components/arrival-panel";
import { ArtistDot, DefinitionList, Field, PageHeader, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { arrivalFor } from "@/lib/bookings";
import { buildChecklist } from "@/lib/checklist";
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
} from "@/lib/constants";
import { getSettings, prisma } from "@/lib/db";
import { dealBreakdown, formatMoney, paymentTotals } from "@/lib/money";
import { formatDate, formatDateTime, localDateKey, localTime, zoneLabel } from "@/lib/time";

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
  const [others, activity] = await Promise.all([
    prisma.booking.findMany({
      where: { agencyId: user.agencyId, artistId: booking.artistId, id: { not: booking.id }, setStart: { gte: windowStart, lte: windowEnd } },
      select: {
        id: true,
        reference: true,
        status: true,
        artistId: true,
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
  const checklist = buildChecklist(booking, others, totals.depositReceivedMinor, now, settings.changeoverMinutes);
  const arrival = arrivalFor(booking, settings, now);
  const money = (m: number) => formatMoney(m, booking.currency);
  const zone = zoneLabel(booking.arriveBy, tz);

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-2">
              <ArtistDot colour={booking.artist.colour} />
              {booking.artist.name}
            </span>
            <StatusBadge status={booking.status} />
          </span>
        }
        subtitle={
          <>
            {booking.reference} · {eventTypeLabel(booking.eventType)} · {formatDate(booking.arriveBy, tz)}
            {booking.venue ? ` · ${booking.venue.name}${booking.venue.city ? `, ${booking.venue.city}` : ""}` : ""}
            {booking.eventName ? ` · ${booking.eventName}` : ""}
          </>
        }
        actions={
          <>
            <Link href={`/bookings/${booking.id}/edit`} className="btn">
              Edit
            </Link>
            <a href={`/print/bookings/${booking.id}/contract`} target="_blank" className="btn">
              Contract
            </a>
            <a href={`/print/bookings/${booking.id}/invoice`} target="_blank" className="btn">
              Invoice
            </a>
            <a href={`/print/bookings/${booking.id}/itinerary`} target="_blank" className="btn">
              Itinerary
            </a>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <ArrivalPanel booking={booking} arrival={arrival} settings={settings} />

          <section className="card card-pad">
            <h2 className="section-title mb-4">Log a check-in for the artist</h2>
            <p className="mb-4 text-sm text-slate-500">
              Use this if the artist can&apos;t use the app, for example the promoter rang to say they&apos;re in. It is marked as logged by
              the agency.
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
              <Field label={`Time (${zone})`} hint="Blank means now">
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
                      <strong>{CHECK_IN_KIND_LABELS[c.kind as keyof typeof CHECK_IN_KIND_LABELS] ?? c.kind}</strong> at{" "}
                      {formatDateTime(c.at, tz)} {c.source === "AGENT" ? `· logged by ${c.user?.name ?? "agency"}` : "· from the artist app"}
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
                  "Promoter",
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
                ["Agent", booking.agent?.name ?? ""],
                ["Tags", booking.tags],
                ["Travel", booking.travel],
                ["Accommodation", booking.accommodation],
                ["Day of show contact", booking.dayContact],
                ["Hospitality", booking.hospitality],
                ["Internal notes", booking.notes],
                [
                  "Radius clause",
                  booking.radiusKm !== null ? `${booking.radiusKm} km, ${booking.radiusDays} days either side` : "",
                ],
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
            <form action={setBookingStatus.bind(null, booking.id)} className="flex gap-2">
              <select name="status" defaultValue={booking.status} className="input">
                {BOOKING_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {BOOKING_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn">Update</SubmitButton>
            </form>
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
              <Row label="Deal">{DEAL_TYPE_LABELS[booking.dealType as DealType] ?? booking.dealType}</Row>
              <Row label="Fee">{money(deal.grossMinor)}</Row>
              {deal.vatMinor > 0 && <Row label={`VAT (${booking.vatPct}%)`}>{money(deal.vatMinor)}</Row>}
              <Row label="Promoter pays">{money(deal.totalDueMinor)}</Row>
              <Row label={booking.dealType === "BUY_SELL" ? "Agency margin" : `Commission (${booking.commissionPct}%)`}>
                {money(deal.agencyMinor)}
              </Row>
              <Row label="Artist earns">{money(deal.artistMinor)}</Row>
              <hr className="border-slate-100" />
              {booking.depositMinor > 0 && (
                <Row label="Deposit">
                  {money(totals.depositReceivedMinor)} of {money(booking.depositMinor)}
                  {booking.depositDueDate && <span className="block text-xs text-slate-500">due {formatDate(booking.depositDueDate, tz)}</span>}
                </Row>
              )}
              <Row label="Received">{money(totals.receivedMinor)}</Row>
              <Row label="Still owed by promoter">
                <strong>{money(Math.max(0, deal.totalDueMinor - totals.receivedMinor))}</strong>
              </Row>
              <Row label="Paid to artist">{money(totals.paidOutMinor)}</Row>
              <Row label="Still owed to artist">
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

          <form action={deleteBooking.bind(null, booking.id)}>
            <ConfirmButton message={`Delete ${booking.reference}? This removes its payments and check-ins too.`} className="btn btn-danger w-full">
              Delete booking
            </ConfirmButton>
          </form>
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
