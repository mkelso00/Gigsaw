import { recordEventPayment } from "@/actions/events";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";

export function RecordPaymentSection({ eventId, currency, today }: { eventId: string; currency: string; today: string }) {
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-3">Record a payment</h2>
      <ActionForm action={recordEventPayment.bind(null, eventId)} className="grid grid-cols-2 gap-3">
        <Field label={`Amount (${currency})`}>
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
      <p className="hint">Shared across the acts&apos; bookings automatically, soonest first.</p>
    </section>
  );
}
