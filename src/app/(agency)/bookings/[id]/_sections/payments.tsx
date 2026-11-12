import { addPayment, deletePayment } from "@/actions/bookings";
import { ActionForm, ConfirmButton, SubmitButton, ServerForm } from "@/components/forms";
import { Field } from "@/components/ui";
import { PAYMENT_KINDS, PAYMENT_KIND_LABELS, type PaymentKind } from "@/lib/constants";
import { formatMoney } from "@/lib/money";
import { formatDate, localDateKey } from "@/lib/time";
import type { BookingView } from "../_data";

export function PaymentsSection({ booking, now }: { booking: BookingView; now: Date }) {
  const tz = booking.timezone;
  const money = (m: number) => formatMoney(m, booking.currency);
  return (
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
                  <ServerForm action={deletePayment.bind(null, p.id)}>
                    <ConfirmButton message="Remove this payment?" className="btn btn-sm btn-danger">
                      Remove
                    </ConfirmButton>
                  </ServerForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <details className="group">
        <summary className="btn btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">Add a payment</summary>
        <div className="motion-page-in mt-4">
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
        </div>
      </details>
    </section>
  );
}
