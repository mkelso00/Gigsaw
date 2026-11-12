import { deleteCheckIn, logCheckInForArtist } from "@/actions/bookings";
import { ActionForm, ConfirmButton, SubmitButton, ServerForm } from "@/components/forms";
import { Field } from "@/components/ui";
import { CHECK_IN_KINDS, CHECK_IN_KIND_LABELS } from "@/lib/constants";
import { formatDateTime, localDateKey } from "@/lib/time";
import type { BookingView } from "../_data";

export function CheckInsSection({ booking, now, zone }: { booking: BookingView; now: Date; zone: string }) {
  const tz = booking.timezone;
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-4">Check-ins</h2>
      {/* Folded away until needed: most check-ins come from the act app. */}
      <details className="group">
        <summary className="btn btn-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">Log one by hand</summary>
        <div className="motion-page-in mt-4">
          <p className="mb-4 text-sm text-slate-500">
            Use this if the act can&apos;t use the app, for example the venue rang to say they&apos;re in. Leave the time blank for now. It is marked as logged
            by you.
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
        </div>
      </details>
      {booking.checkIns.length > 0 && (
        <ul className="mt-5 divide-y divide-slate-100 border-t border-slate-100 text-sm">
          {booking.checkIns.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <span>
                <strong>{CHECK_IN_KIND_LABELS[c.kind as keyof typeof CHECK_IN_KIND_LABELS] ?? c.kind}</strong> at {formatDateTime(c.at, tz)}{" "}
                {c.source === "AGENT" ? `· logged by ${c.user?.name ?? "agency"}` : "· from the act app"}
                {c.note && <span className="text-slate-500"> · “{c.note}”</span>}
              </span>
              <ServerForm action={deleteCheckIn.bind(null, c.id)}>
                <ConfirmButton message="Remove this check-in?" className="btn btn-sm btn-danger">
                  Remove
                </ConfirmButton>
              </ServerForm>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
