import { sendActDetailsNow, sendPlannerNow } from "@/actions/events";
import { CopyField } from "@/components/client-bits";
import { ActionForm, SubmitButton } from "@/components/forms";
import type { EventMessage } from "@/lib/event-plan";
import { plannerUrl } from "@/lib/events";
import { addDaysToKey, formatDateTime } from "@/lib/time";
import type { EventPageData, EventView } from "../_data";
import { dayLabel } from "./day-label";

// Each automatic email's sending window, in days before (+) or after (−) the event. Matches eventMessagesDue.
const AUTO: { kind: EventMessage; label: string; from: number; to: number; who: string }[] = [
  { kind: "PLANNER_REQUEST", label: "Ask for their details (planner link)", from: 56, to: 22, who: "Customer" },
  { kind: "PLANNER_CHASE", label: "Reminder, if the planner isn't filled in", from: 21, to: 8, who: "Customer" },
  { kind: "BALANCE_REMINDER", label: "Balance reminder, if anything is owed", from: 14, to: 1, who: "Customer" },
  { kind: "ACT_DETAILS", label: "Final details: times, running order, contacts", from: 7, to: 0, who: "Acts" },
  { kind: "THANKS", label: "Thank-you and review request", from: -1, to: -7, who: "Customer" },
];

export function PlannerSection({ event: e }: { event: EventView }) {
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

/** Where each automatic email stands: sent, not needed, waiting for its window, or missed. */
export function AutoEmailsSection({
  event: e,
  totals: t,
  sent,
  daysLeft,
  eventEmails,
}: {
  event: EventView;
  totals: EventPageData["totals"];
  sent: EventPageData["sent"];
  daysLeft: number;
  eventEmails: boolean;
}) {
  const emailsOn = e.autoEmails && eventEmails;
  return (
    <section className="card card-pad">
      <h2 className="section-title">Automatic emails</h2>
      <p className="mt-1 mb-3 text-sm text-ink-500">
        {emailsOn
          ? "Sent between 9am and 8pm, each only once, and only when still needed."
          : !eventEmails
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
  );
}
