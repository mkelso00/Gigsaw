import Link from "next/link";
import { sendEventStepNow, sendPlannerNow, sendPlanToActsNow } from "@/actions/events";
import { CopyField } from "@/components/client-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import { BALANCE_DUE_DAYS, EVENT_STEPS, isSecured, JOURNEY_STAGES, stepWindow, type EventMessage, type JourneyStage } from "@/lib/event-plan";
import { missedAtLaunch, owedToUs, plannerUrl } from "@/lib/events";
import { addDaysToKey, formatDateTime } from "@/lib/time";
import type { EventPageData, EventView } from "../_data";
import { dayLabel } from "./day-label";

/** Gigs with an act on them, that the acts would be sent the plan for. */
const actGigs = (e: EventView) => e.bookings.filter((b) => b.artistId && b.status !== "CANCELLED" && b.status !== "ENQUIRY");

export function PlannerSection({ event: e, daysLeft }: { event: EventView; daysLeft: number }) {
  // From 3 months out (when the balance is due) the plan should be in: if it isn't, staff can send the acts what they have.
  const planLate = !e.plannerDoneAt && daysLeft >= 0 && daysLeft <= BALANCE_DUE_DAYS && actGigs(e).length > 0;
  return (
    <section className="card card-pad">
      <h2 className="section-title">Customer&apos;s planner</h2>
      <p className="mt-1 mb-3 text-sm text-ink-500">
        {e.plannerDoneAt
          ? "Filled in. They can still change it from the same link."
          : e.plannerSentAt
            ? `Link sent ${formatDateTime(e.plannerSentAt, e.timezone)}. Not filled in yet.`
            : "A private page where the customer tells you the running order, contacts, parking and song requests."}
      </p>
      {planLate && (
        <div role="note" className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">The running order isn&apos;t in yet</p>
          {e.planToldActs == null ? (
            <>
              <p className="mt-1">
                {e.type === "WEDDING" ? "The wedding" : "It"} is {daysLeft} {daysLeft === 1 ? "day" : "days"} away and the acts haven&apos;t had the plan. Fill
                in what you know, then send it to them. They&apos;ll still get their final details a week before, and hear about any changes.
              </p>
              <ActionForm action={sendPlanToActsNow.bind(null, e.id)} className="mt-3">
                <SubmitButton className="btn w-full" pendingText="Sending…">
                  Send the plan to the acts
                </SubmitButton>
              </ActionForm>
            </>
          ) : (
            <p className="mt-1">The acts have the plan as it was when you sent it. Anything you or the customer change reaches them as an update.</p>
          )}
        </div>
      )}
      {e.plannerToken && <CopyField value={plannerUrl(e.plannerToken)} />}
      <ActionForm action={sendPlannerNow.bind(null, e.id)} className="mt-3">
        <SubmitButton className="btn w-full" pendingText="Sending…">
          {e.plannerSentAt ? "Email the link again" : "Email the planner link now"}
        </SubmitButton>
      </ActionForm>
      {!e.customer?.email && <p className="hint">Add the customer&apos;s email address to send it.</p>}
    </section>
  );
}

const STAGE_TITLES: Record<JourneyStage, string> = {
  SIX_MONTHS: "6 months before",
  THREE_MONTHS: "3 months before: balance due",
  FOUR_WEEKS: "4 weeks before: running order due",
  ONE_WEEK: "1 week before",
  AFTER: "After the day",
};

/** Where each automatic email stands (sent, not needed, waiting for its window, or missed), each with a Send now button. */
export function AutoEmailsSection({
  event: e,
  sent,
  checked,
  daysLeft,
  eventEmails,
  reviewLink,
  coordinator,
}: {
  event: EventView;
  sent: EventPageData["sent"];
  checked: EventPageData["checked"];
  daysLeft: number;
  eventEmails: boolean;
  reviewLink: string;
  coordinator: string | null;
}) {
  const emailsOn = e.autoEmails && eventEmails;
  const secured = isSecured(e.bookings);
  const customer = e.type === "WEDDING" ? "Couple" : "Customer";
  const owed = owedToUs(e);
  /** Whether a step still has something to say, and if not, why not. */
  const notNeeded = (kind: EventMessage, to: string): string | null => {
    if (to === "CUSTOMER" && !e.customer?.email) return "no email address for them";
    if (to === "TEAM" && !coordinator) return "no lead agent or business email to send it to";
    if (to === "ACTS" && !actGigs(e).length) return "no acts yet";
    if ((kind === "PLANNER_REQUEST" || kind === "PLANNER_CHASE" || kind === "PLANNER_FINAL" || kind === "TEAM_PLANNER_LATE") && e.plannerDoneAt)
      return "the planner is filled in";
    if (kind === "BALANCE_REMINDER" && owed <= 0) return "nothing is owed to you";
    return null;
  };
  return (
    <section className="card card-pad">
      <h2 className="section-title">Automatic emails</h2>
      <p className="mt-1 mb-3 text-sm text-ink-500">
        {!emailsOn
          ? !eventEmails
            ? "Turned off for all events in Settings. You can still send any of them now."
            : "Turned off for this event (edit the details below the plan). You can still send any of them now."
          : secured
            ? "Sent between 9am and 8pm, each only once, and only when still needed. Booked late? Send any of them now."
            : "Waiting for the booking to be secured: nothing goes to the customer, or about them, until then."}
      </p>
      <div className="space-y-4">
        {JOURNEY_STAGES.map(({ stage }) => (
          <div key={stage}>
            <h3 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">{STAGE_TITLES[stage]}</h3>
            <ul className="mt-1.5 space-y-3 text-sm">
              {EVENT_STEPS.filter((s) => s.stage === stage).map((s) => {
                const { from, to } = stepWindow(s.kind);
                const done = sent.has(s.kind);
                const why = notNeeded(s.kind, s.to);
                const waitsForSecure = s.to !== "ACTS" && !secured;
                const state = done
                  ? "sent"
                  : why
                    ? `not needed: ${why}`
                    : daysLeft > from
                      ? `from ${dayLabel(addDaysToKey(e.date, -from), { day: "numeric", month: "short", year: "numeric" })}${waitsForSecure ? ", once the booking is secured" : ""}`
                      : daysLeft >= to
                        ? checked.has(s.kind)
                          ? "not needed when it fell due"
                          : !emailsOn
                            ? "due, but automatic emails are off"
                            : waitsForSecure
                              ? "due, waiting for the booking to be secured"
                              : missedAtLaunch(e, s.kind)
                                ? "not sent by itself: it fell due before this email started. Send it now if you'd like"
                                : "due now, goes out shortly"
                        : checked.has(s.kind)
                          ? "not needed when it fell due"
                          : "missed: its window has passed";
                const who = s.to === "CUSTOMER" ? customer : s.to === "ACTS" ? "Acts" : coordinator ? `To ${coordinator}` : "To your team";
                return (
                  <li key={s.kind} className="flex items-start gap-2" data-step={s.kind}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${done ? "bg-emerald-500" : "bg-ink-300"}`} />
                    <div className="min-w-0 flex-1">
                      <span className={done ? "text-ink-500" : ""}>{s.label}</span>
                      <span className="block text-xs text-ink-500">
                        {who} · {state}
                      </span>
                      {s.kind === "THANKS" && !reviewLink.trim() && (
                        <span className="block text-xs text-amber-700">
                          No review link yet, so it won&apos;t ask for a review.{" "}
                          <Link href="/settings/weddings" className="underline">
                            Add one in Settings
                          </Link>
                        </span>
                      )}
                      <ActionForm action={sendEventStepNow.bind(null, e.id, s.kind)} className="mt-1.5">
                        <SubmitButton className="btn btn-sm" pendingText="Sending…">
                          {done ? "Send again" : "Send now"}
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
