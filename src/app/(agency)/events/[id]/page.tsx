import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  addEventAct,
  addEventTask,
  deleteEvent,
  deleteEventTask,
  recordEventPayment,
  sendActDetailsNow,
  sendPlannerNow,
  toggleEventTask,
  updateEvent,
  updateEventPlan,
} from "@/actions/events";
import { CopyField } from "@/components/client-bits";
import { ContractPanel } from "@/components/contract-panel";
import { EventForm } from "@/components/event-form";
import { PayLinksCard } from "@/components/pay-links-card";
import { cardPaymentsReady } from "@/lib/card-payments";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { ArtistDot, Field, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { BOOKING_STATUS_LABELS, actName } from "@/lib/constants";
import { contractState, eventContractDoc } from "@/lib/contract-doc";
import { contractStatusFor } from "@/lib/contracts";
import { getSettings, prisma } from "@/lib/db";
import { eventFormOptions } from "@/lib/event-options";
import { PLAN_FIELDS, daysBetween, type EventMessage } from "@/lib/event-plan";
import { autoDone, eventInclude, eventTotals, plannerUrl, sentEventMessages } from "@/lib/events";
import { dealBreakdown, formatMoney } from "@/lib/money";
import { addDaysToKey, formatDateTime, localDateKey, localTime } from "@/lib/time";

export const metadata: Metadata = { title: "Wedding or event" };

const TYPE: Record<string, string> = { WEDDING: "Wedding", PRIVATE_PARTY: "Private party", CORPORATE: "Corporate event", OTHER: "Event" };
const dayLabel = (key: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long", year: "numeric" }) =>
  new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

// Each automatic email's sending window, in days before (+) or after (−) the event. Matches eventMessagesDue.
const AUTO: { kind: EventMessage; label: string; from: number; to: number; who: string }[] = [
  { kind: "PLANNER_REQUEST", label: "Ask for their details (planner link)", from: 56, to: 22, who: "Customer" },
  { kind: "PLANNER_CHASE", label: "Reminder, if the planner isn't filled in", from: 21, to: 8, who: "Customer" },
  { kind: "BALANCE_REMINDER", label: "Balance reminder, if anything is owed", from: 14, to: 1, who: "Customer" },
  { kind: "ACT_DETAILS", label: "Final details: times, running order, contacts", from: 7, to: 0, who: "Acts" },
  { kind: "THANKS", label: "Thank-you and review request", from: -1, to: -7, who: "Customer" },
];

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [e, settings, options, acts, tasks, sent, payLinks] = await Promise.all([
    prisma.event.findFirst({ where: { id, agencyId: user.agencyId }, include: eventInclude }),
    getSettings(user.agencyId),
    eventFormOptions(user.agencyId),
    prisma.artist.findMany({ where: { agencyId: user.agencyId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.eventTask.findMany({ where: { eventId: id, event: { agencyId: user.agencyId } }, orderBy: [{ sort: "asc" }, { dueDate: "asc" }] }),
    sentEventMessages(id),
    prisma.payLink.findMany({ where: { eventId: id, agencyId: user.agencyId } }),
  ]);
  if (!e) notFound();
  const today = localDateKey(new Date(), e.timezone);
  const t = eventTotals(e.bookings);
  const m = (x: number) => formatMoney(x, t.currency);
  const daysLeft = daysBetween(today, e.date);
  const where = e.venue ? `${e.venue.name}${e.venue.city ? `, ${e.venue.city}` : ""}` : e.venueText;
  const emailsOn = e.autoEmails && settings.eventEmails;
  const lastBooking = e.bookings.at(-1);
  const contractDoc = eventContractDoc({ ...e, reference: e.bookings[0]?.reference ?? e.id.slice(-6).toUpperCase() }, settings);
  const contract = await contractStatusFor(user.agencyId, { kind: "event", id: e.id }, contractDoc);
  const contractSigned = contractState(contract.current) === "SIGNED" && !contract.changes.length;

  return (
    <div>
      <PageHeader
        eyebrow={`${TYPE[e.type] ?? "Event"}${daysLeft > 0 ? ` · in ${daysLeft} day${daysLeft === 1 ? "" : "s"}` : daysLeft === 0 ? " · today" : ""}`}
        title={e.name}
        subtitle={[dayLabel(e.date), where, e.customer?.name].filter(Boolean).join(" · ")}
        actions={
          <>
            {e.bookings.length > 0 && (
              <>
                <Link href={`/print/events/${e.id}/contract`} className="btn" target="_blank">
                  Contract
                </Link>
                <Link href={`/print/events/${e.id}/invoice`} className="btn" target="_blank">
                  Invoice
                </Link>
              </>
            )}
            {e.customer && (
              <Link href={`/contacts/${e.customer.id}`} className="btn">
                Customer
              </Link>
            )}
          </>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label="Customer pays"
          value={t.total ? m(t.total) : "–"}
          hint={[t.fees ? `incl. ${m(t.fees)} booking fee` : "", t.vat ? `VAT ${m(t.vat)}` : "", `${t.acts} act${t.acts === 1 ? "" : "s"}`]
            .filter(Boolean)
            .join(" · ")}
        />
        <Stat label="Received" value={m(t.received)} hint={t.deposits ? `Deposits ${m(t.deposits)}` : "No payments yet"} />
        <Stat
          tone={t.outstanding && daysLeft <= 14 ? "alert" : "default"}
          label="Left to pay"
          value={m(t.outstanding)}
          hint={t.total && !t.outstanding ? "Paid in full" : undefined}
        />
        <Stat tone="dark" label="We make" value={m(t.margin)} hint={`Acts are paid ${m(t.cost)}${t.fees ? ` · booking fee ${m(t.fees)}` : ""}`} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-8">
          <section>
            <h2 className="mb-3 text-[17px] font-semibold tracking-tight">Acts</h2>
            <div className="card overflow-x-auto">
              {e.bookings.length > 0 && (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Act</th>
                      <th>Arrive</th>
                      <th>On</th>
                      <th>Status</th>
                      <th className="text-right">Sale</th>
                      <th className="text-right">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.bookings.map((b) => {
                      const d = dealBreakdown(b);
                      return (
                        <tr key={b.id} className={b.status === "CANCELLED" ? "opacity-50" : ""}>
                          <td>
                            <Link href={`/bookings/${b.id}`} className="flex items-center gap-2 font-medium hover:underline">
                              <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                              {actName(b)}
                            </Link>
                            <div className="pl-[18px] text-xs text-ink-500">{b.reference}</div>
                          </td>
                          <td className="tabular-nums">{localTime(b.arriveBy, b.timezone)}</td>
                          <td className="tabular-nums">
                            {localTime(b.setStart, b.timezone)}
                            {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                          </td>
                          <td>
                            <StatusBadge status={b.status} />
                            {b.customerToldAt && <div className="mt-1 text-xs text-emerald-700">Customer told</div>}
                            {b.offerResponse === "DECLINED" && b.status === "AWAITING" && (
                              <div className="mt-1 text-xs font-medium text-rose-700">Act declined</div>
                            )}
                          </td>
                          <td className="text-right tabular-nums">{m(d.totalDueMinor)}</td>
                          <td className="text-right tabular-nums text-ink-600">{m(d.artistMinor)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              <div className={`p-5 ${e.bookings.length ? "border-t border-ink-100" : ""}`}>
                <h3 className="mb-3 text-sm font-medium text-ink-800">Add an act</h3>
                <ActionForm action={addEventAct.bind(null, e.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <label className="sm:col-span-2">
                    <span className="label">Act</span>
                    <select name="artistId" defaultValue="" className="input">
                      <option value="">No act yet (add later)</option>
                      {acts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="label">Status</span>
                    <select name="status" defaultValue="PENDING" className="input">
                      {(["PENDING", "AWAITING", "CONFIRMED", "HOLD", "ENQUIRY"] as const).map((s) => (
                        <option key={s} value={s}>
                          {BOOKING_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="label">VAT %</span>
                    <input name="vatPct" inputMode="decimal" defaultValue={lastBooking?.vatPct || ""} placeholder="0" className="input" />
                  </label>
                  <label>
                    <span className="label">Arrive</span>
                    <input name="arriveTime" type="time" className="input" />
                  </label>
                  <label>
                    <span className="label">On</span>
                    <input name="startTime" type="time" required className="input" />
                  </label>
                  <label>
                    <span className="label">Finish</span>
                    <input name="endTime" type="time" className="input" />
                  </label>
                  <div />
                  <label>
                    <span className="label">Sale ({settings.defaultCurrency})</span>
                    <input name="sale" inputMode="decimal" placeholder="What the customer pays" className="input" />
                  </label>
                  <label>
                    <span className="label">Cost</span>
                    <input name="cost" inputMode="decimal" placeholder="The act's fee" className="input" />
                  </label>
                  <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="notify" defaultChecked className="h-4 w-4" />
                      Tell the act
                    </label>
                    <SubmitButton className="btn btn-primary ml-auto" pendingText="Adding…">
                      Add act
                    </SubmitButton>
                  </div>
                </ActionForm>
                <p className="hint">Each act gets its own booking: they see their times, the plan below and their own fee (the cost). Never the sale.</p>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-[17px] font-semibold tracking-tight">The plan</h2>
              <span className="text-sm text-ink-500">
                {e.plannerDoneAt
                  ? `Filled in by the customer, last changed ${formatDateTime(e.updatedAt, e.timezone)}`
                  : "Shared with the acts. The customer can fill it in from their planner link."}
              </span>
            </div>
            <ActionForm action={updateEventPlan.bind(null, e.id)} className="card card-pad grid gap-4 sm:grid-cols-2">
              <Field label="Guests" className="sm:max-w-40">
                <input name="guestCount" inputMode="numeric" defaultValue={e.guestCount ?? ""} className="input" />
              </Field>
              <div />
              {PLAN_FIELDS.map(([k, label, hint]) => (
                <Field
                  key={k}
                  label={label}
                  hint={hint || undefined}
                  className={k === "timeline" || k === "songRequests" || k === "specialNotes" ? "sm:col-span-2" : ""}
                >
                  <textarea name={k} rows={k === "timeline" ? 5 : 2} defaultValue={e[k]} className="input" />
                </Field>
              ))}
              <div className="sm:col-span-2">
                <SubmitButton className="btn btn-primary">Save plan</SubmitButton>
              </div>
            </ActionForm>
          </section>

          <details className="card">
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium">Edit date, customer, venue and name</summary>
            <div className="border-t border-ink-100 p-5">
              <EventForm
                action={updateEvent.bind(null, e.id)}
                values={{ ...e, customerId: e.customerId ?? undefined, venueId: e.venueId ?? undefined }}
                {...options}
                submitLabel="Save"
                editing
              />
            </div>
          </details>
        </div>

        <div className="space-y-6">
          <section className="card card-pad">
            <h2 className="section-title mb-3">Checklist</h2>
            <ul className="space-y-1">
              {tasks.map((task) => {
                const auto = autoDone(task.key, e, t, sent, contractSigned);
                const done = !!task.doneAt || auto;
                const late = !done && task.dueDate && task.dueDate < today;
                return (
                  <li key={task.id} className="group flex items-start gap-2">
                    <form action={toggleEventTask.bind(null, task.id)}>
                      <button
                        disabled={auto && !task.doneAt}
                        className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-md border text-xs ${done ? "border-emerald-500 bg-emerald-500 text-white" : "border-ink-300 hover:border-ink-950"}`}
                        aria-label={done ? `Mark "${task.title}" as not done` : `Mark "${task.title}" as done`}
                      >
                        {done ? "✓" : ""}
                      </button>
                    </form>
                    <div className="min-w-0 flex-1 text-sm">
                      <div className={done ? "text-ink-500 line-through" : ""}>{task.title}</div>
                      <div className={`text-xs ${late ? "font-medium text-rose-700" : "text-ink-500"}`}>
                        {auto && !task.doneAt
                          ? "Done automatically"
                          : task.dueDate
                            ? `${late ? "Overdue: " : "By "}${dayLabel(task.dueDate, { day: "numeric", month: "short" })}`
                            : ""}
                      </div>
                    </div>
                    {!task.key && (
                      <form action={deleteEventTask.bind(null, task.id)} className="opacity-0 group-hover:opacity-100">
                        <button className="text-xs text-ink-400 hover:text-rose-700" aria-label={`Delete "${task.title}"`}>
                          ✕
                        </button>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
            <ActionForm action={addEventTask.bind(null, e.id)} className="mt-4 grid grid-cols-[1fr_auto] gap-2 border-t border-ink-100 pt-4">
              <input name="title" required placeholder="Add a task, e.g. Book the PA" className="input" />
              <SubmitButton className="btn">Add</SubmitButton>
              <input name="dueDate" type="date" aria-label="Due date" className="input col-span-2" />
            </ActionForm>
          </section>

          <ContractPanel
            kind="event"
            id={e.id}
            status={contract}
            timeZone={e.timezone}
            signer={e.customer ? { name: e.customer.name, email: e.customer.email } : null}
            previewHref={`/print/events/${e.id}/contract`}
          />

          <section className="card card-pad">
            <h2 className="section-title">Customer&apos;s planner</h2>
            <p className="mt-1 mb-3 text-sm text-ink-500">
              {e.plannerDoneAt
                ? "Filled in. They can still change it from the same link."
                : e.plannerSentAt
                  ? `Link sent ${formatDateTime(e.plannerSentAt, e.timezone)}. Not filled in yet.`
                  : "A private page where the customer tells you the running order, contacts, parking and song requests."}
            </p>
            {e.plannerToken && <CopyField value={plannerUrl(e.plannerToken)} />}
            <ActionForm action={sendPlannerNow.bind(null, e.id)} className="mt-3">
              <SubmitButton className="btn w-full" pendingText="Sending…">
                {e.plannerSentAt ? "Email the link again" : "Email the planner link now"}
              </SubmitButton>
            </ActionForm>
            {!e.customer?.email && <p className="hint">Add the customer&apos;s email address to send it.</p>}
          </section>

          <section className="card card-pad">
            <h2 className="section-title">Automatic emails</h2>
            <p className="mt-1 mb-3 text-sm text-ink-500">
              {emailsOn
                ? "Sent between 9am and 8pm, each only once, and only when still needed."
                : !settings.eventEmails
                  ? "Turned off for all events in Settings."
                  : "Turned off for this event (edit the details below the plan)."}
            </p>
            <ul className="space-y-2.5 text-sm">
              {AUTO.map((a) => {
                const done = sent.has(a.kind);
                const when = addDaysToKey(e.date, -a.from);
                const needed =
                  a.kind === "PLANNER_REQUEST" || a.kind === "PLANNER_CHASE"
                    ? !e.plannerDoneAt && !!e.customer?.email
                    : a.kind === "BALANCE_REMINDER"
                      ? t.outstanding > 0 && !!e.customer?.email
                      : a.kind === "ACT_DETAILS"
                        ? e.bookings.length > 0
                        : !!e.customer?.email;
                const state = done
                  ? "sent"
                  : !needed
                    ? "not needed"
                    : daysLeft > a.from
                      ? `from ${dayLabel(when, { day: "numeric", month: "short" })}`
                      : daysLeft >= a.to
                        ? emailsOn
                          ? "due now, goes out shortly"
                          : "due, but automatic emails are off"
                        : "not sent: its window has passed";
                return (
                  <li key={a.kind} className="flex items-start gap-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${done ? "bg-emerald-500" : "bg-ink-300"}`} />
                    <span className="min-w-0">
                      <span className={done ? "text-ink-500" : ""}>{a.label}</span>
                      <span className="block text-xs text-ink-500">
                        {a.who} · {state}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
            <ActionForm action={sendActDetailsNow.bind(null, e.id)} className="mt-4">
              <SubmitButton className="btn w-full" pendingText="Sending…">
                Send final details to the acts now
              </SubmitButton>
            </ActionForm>
          </section>

          {e.status === "ACTIVE" && (
            <PayLinksCard
              target="event"
              id={e.id}
              gigs={e.bookings.filter((b) => b.status !== "CANCELLED")}
              links={payLinks}
              currency={t.currency}
              ready={cardPaymentsReady(user.agency!)}
              isAdmin={user.role === "ADMIN"}
              email={e.customer?.email ?? ""}
              timezone={e.timezone}
            />
          )}

          <section className="card card-pad">
            <h2 className="section-title mb-3">Record a payment</h2>
            <ActionForm action={recordEventPayment.bind(null, e.id)} className="grid grid-cols-2 gap-3">
              <Field label={`Amount (${t.currency})`}>
                <input name="amount" inputMode="decimal" required className="input" />
              </Field>
              <Field label="Type">
                <select name="kind" className="input">
                  <option value="DEPOSIT">Deposit</option>
                  <option value="BALANCE">Balance</option>
                </select>
              </Field>
              <Field label="Date">
                <input name="paidAt" type="date" defaultValue={today} className="input" />
              </Field>
              <Field label="Note">
                <input name="note" className="input" />
              </Field>
              <div className="col-span-2">
                <SubmitButton className="btn btn-primary w-full">Record payment</SubmitButton>
              </div>
            </ActionForm>
            <p className="hint">Shared across the acts&apos; gigs automatically, soonest first.</p>
          </section>

          {e.notes && (
            <section className="card card-pad">
              <h2 className="section-title mb-2">Notes</h2>
              <p className="text-sm whitespace-pre-wrap text-ink-700">{e.notes}</p>
            </section>
          )}

          <form action={deleteEvent.bind(null, e.id)}>
            <ConfirmButton message="Delete this wedding or event? The acts' gigs stay as normal bookings." className="btn btn-danger w-full">
              Delete
            </ConfirmButton>
          </form>
        </div>
      </div>
    </div>
  );
}
