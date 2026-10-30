import { addAway, removeAway } from "@/actions/availability";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { blockLength, formatRange } from "@/lib/availability";
import type { AwayEntry } from "@/lib/away";

/** Staff: an act's blocked-out dates on their page, with a form to add more. */
export function AwayCard({ artistId, actName, entries, today }: { artistId: string; actName: string; entries: AwayEntry[]; today: string }) {
  return (
    <section className="card card-pad" id="away">
      <h2 className="section-title">Dates they can&apos;t play</h2>
      <p className="mt-1 mb-4 text-sm text-ink-500">
        Holidays and other work. The act can add these in their app too. Booking them on one of these days asks you to check first.
      </p>
      {entries.length > 0 ? (
        <ul className="mb-4 divide-y divide-ink-100 text-sm">
          {entries.map((e) => (
            <li key={`${e.id}-${e.artistId}`} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="font-medium">
                  {formatRange(e.startDate, e.endDate)}
                  {blockLength(e) > 1 && <span className="font-normal text-ink-500"> · {blockLength(e)} days</span>}
                </div>
                <div className="truncate text-xs text-ink-500">
                  {e.own ? e.note || "No note" : `${e.actName} can't play${e.note ? ` (${e.note})` : ""}`}
                  {e.startDate <= today && today <= e.endDate ? " · away now" : ""}
                </div>
              </div>
              {e.own ? (
                <form action={removeAway.bind(null, e.id)}>
                  <ConfirmButton message={`Remove ${formatRange(e.startDate, e.endDate)} for ${actName}?`} className="btn btn-sm">
                    Remove
                  </ConfirmButton>
                </form>
              ) : (
                <span className="text-xs text-ink-400">On {e.actName}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 text-sm text-ink-500">None coming up.</p>
      )}
      <ActionForm action={addAway.bind(null, artistId)} className="grid grid-cols-2 gap-2">
        <label>
          <span className="label">From</span>
          <input type="date" name="startDate" required min={today} className="input" />
        </label>
        <label>
          <span className="label">To (optional)</span>
          <input type="date" name="endDate" min={today} className="input" />
        </label>
        <input name="note" maxLength={200} placeholder="Note, e.g. Holiday" aria-label="Note" className="input col-span-2" />
        <SubmitButton className="btn col-span-2 sm:col-span-1 sm:justify-self-start">Block out</SubmitButton>
      </ActionForm>
    </section>
  );
}
