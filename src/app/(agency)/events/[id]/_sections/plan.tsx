import { updateEvent, updateEventPlan } from "@/actions/events";
import { EventForm } from "@/components/event-form";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { planFieldsFor, type PlanExtraField } from "@/lib/event-plan";
import { formatDateTime } from "@/lib/time";
import type { EventPageData, EventView } from "../_data";

/** The running order and details the acts see, which the customer can also fill in from their planner. */
export function PlanSection({ event: e, extras }: { event: EventView; extras: PlanExtraField[] }) {
  return (
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
        {planFieldsFor(e, extras).map((f) => (
          <Field
            key={f.name}
            label={f.label}
            hint={f.hint || undefined}
            className={f.name === "timeline" || f.name === "songRequests" || f.name === "specialNotes" ? "sm:col-span-2" : ""}
          >
            <textarea name={f.name} rows={f.name === "timeline" ? 5 : 2} defaultValue={f.value} className="input" />
          </Field>
        ))}
        <div className="sm:col-span-2">
          <SubmitButton className="btn btn-primary">Save plan</SubmitButton>
        </div>
      </ActionForm>
    </section>
  );
}

export function EditEventDetails({ event: e, options }: { event: EventView; options: EventPageData["options"] }) {
  return (
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
  );
}
