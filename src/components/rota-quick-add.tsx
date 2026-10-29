import { addRotaGig } from "@/actions/slots";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";

type Option = { id: string; name: string };

/**
 * Add a gig straight from the rota. In a day cell the venue and date are fixed (compact form);
 * at the top of the page both can be chosen, so any date and any venue can be added.
 */
export function RotaQuickAdd({
  artists,
  venues,
  venueId,
  date,
  minDate,
  currency,
  weekdayName,
}: {
  artists: Option[];
  venues?: Option[];
  venueId?: string;
  date?: string;
  minDate: string;
  currency: string;
  weekdayName?: string;
}) {
  const compact = !!(venueId && date);
  const artistSelect = (cls: string) => (
    <select name="artistId" required defaultValue="" className={cls}>
      <option value="" disabled>
        {compact ? "Artist…" : "Choose…"}
      </option>
      {artists.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  if (compact) {
    const small = "input-sm";
    return (
      <details className="group rota-add">
        <summary className="flex h-7 cursor-pointer list-none items-center justify-center rounded-md border border-dashed border-ink-200 text-xs text-ink-400 transition hover:border-ink-400 hover:text-ink-900 group-open:hidden">
          + Add
        </summary>
        <ActionForm action={addRotaGig} className="space-y-1.5 rounded-lg border border-ink-300 bg-white p-2 shadow-sm">
          <input type="hidden" name="venueId" value={venueId} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="currency" value={currency} />
          <input type="hidden" name="notify" value="on" />
          <label className="block text-[10px] font-medium text-ink-500">
            On stage
            <input name="startTime" type="time" required defaultValue="19:00" className={`${small} mt-0.5`} />
          </label>
          <label className="block text-[10px] font-medium text-ink-500">
            Finish
            <input name="endTime" type="time" required defaultValue="21:00" className={`${small} mt-0.5`} />
          </label>
          {artistSelect(small)}
          <input name="label" placeholder="Solo, duo…" aria-label="Act type" className={small} />
          <input name="fee" inputMode="decimal" placeholder={`Fee (${currency})`} aria-label="Fee" className={small} />
          <label className="flex items-center gap-1.5 text-[11px] leading-tight text-ink-600">
            <input type="checkbox" name="repeat" className="h-3.5 w-3.5 accent-ink-950" />
            Every {weekdayName ?? "week"}
          </label>
          <SubmitButton className="btn btn-sm btn-primary w-full" pendingText="…">
            Book
          </SubmitButton>
        </ActionForm>
      </details>
    );
  }

  return (
    <ActionForm action={addRotaGig} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="currency" value={currency} />
      <Field label="Date">
        <input name="date" type="date" required min={minDate} defaultValue={date} className="input" />
      </Field>
      <Field label="Venue">
        <select name="venueId" required defaultValue="" className="input">
          <option value="" disabled>
            Choose…
          </option>
          {venues?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Artist">{artistSelect("input")}</Field>
      <Field label="Act type" hint="Optional, e.g. Solo">
        <input name="label" className="input" />
      </Field>
      <Field label="Arrive by" hint="Optional: 30 min before if blank">
        <input name="arriveTime" type="time" className="input" />
      </Field>
      <Field label="On stage">
        <input name="startTime" type="time" required defaultValue="19:00" className="input" />
      </Field>
      <Field label="Finish">
        <input name="endTime" type="time" required defaultValue="21:00" className="input" />
      </Field>
      <Field label={`Fee (${currency})`} hint="Optional">
        <input name="fee" inputMode="decimal" className="input" />
      </Field>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:col-span-2 lg:col-span-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="repeat" className="h-4 w-4 accent-ink-950" />
          Every week on this day (adds it to the venue&apos;s schedule)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-ink-950" />
          Tell the artist
        </label>
        <SubmitButton className="btn btn-primary ml-auto" pendingText="Booking…">
          Add gig
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
