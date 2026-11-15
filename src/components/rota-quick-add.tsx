"use client";

import { useState } from "react";
import { addRotaGig } from "@/actions/slots";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { WEEKDAYS, weekdayOf } from "@/lib/rota";

type Option = { id: string; name: string };

const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const shortDay = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

/**
 * Add a gig straight from the rota. In a day cell the venue and date are fixed (compact form);
 * at the top of the page both can be chosen, so any date and any venue can be added. Either can
 * instead start a weekly slot at the venue from that date: in a cell on that day, at the top on
 * the days ticked, up to an optional last date.
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
  const [day, setDay] = useState(date ?? minDate);
  const [weekly, setWeekly] = useState(false);
  // The weekdays for a weekly slot: the chosen date's own day until others are ticked.
  const [days, setDays] = useState<number[] | null>(null);
  const ticked = days ?? (isDay(day) ? [weekdayOf(day)] : []);
  const artistSelect = (cls: string) => (
    <select name="artistId" defaultValue="" className={cls}>
      <option value="">{compact ? "No act yet" : "No act yet (Pending)"}</option>
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
          <input name="fee" inputMode="decimal" placeholder={`Sale (${currency})`} aria-label="Sale" className={small} />
          <input name="cost" inputMode="decimal" placeholder="Cost (act's fee)" aria-label="Cost" className={small} />
          <label className="flex items-center gap-1.5 text-[11px] leading-tight text-ink-600">
            <input type="checkbox" name="repeat" className="h-3.5 w-3.5 accent-ink-950" />
            Every {weekdayName ?? "week"} from this date
          </label>
          <div className="grid grid-cols-2 gap-1">
            <SubmitButton className="btn btn-sm btn-primary w-full px-1" pendingText="…" name="mode" value="offer">
              Offer
            </SubmitButton>
            <SubmitButton className="btn btn-sm w-full px-1" pendingText="…" name="mode" value="confirm">
              Confirm
            </SubmitButton>
          </div>
          <p className="text-[10px] leading-tight text-ink-500">No act: added as Pending.</p>
        </ActionForm>
      </details>
    );
  }

  return (
    <ActionForm action={addRotaGig} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <input type="hidden" name="currency" value={currency} />
      <Field label={weekly ? "Starts on" : "Date"}>
        <input name="date" type="date" required min={minDate} value={day} onChange={(e) => setDay(e.target.value)} className="input" />
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
      <Field label="Act" hint={weekly ? "Optional: the regular act, booked for the first week" : "Optional: leave empty to add the act later"}>
        {artistSelect("input")}
      </Field>
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
      <Field label={`Sale (${currency})`} hint="What the venue or customer pays">
        <input name="fee" inputMode="decimal" className="input" />
      </Field>
      <Field label="Cost (act's fee)" hint="Blank = commission">
        <input name="cost" inputMode="decimal" className="input" />
      </Field>
      <div className="sm:col-span-2 lg:col-span-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="repeat" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} className="h-4 w-4 accent-ink-950" />
          Make it a weekly slot at the venue, from this date
        </label>
        {weekly && (
          <fieldset className="mt-3 grid gap-4 rounded-xl border border-ink-200 bg-ink-50/60 p-4 sm:grid-cols-[1fr_auto]">
            <legend className="sr-only">Weekly slot</legend>
            <div>
              <span className="label">Every</span>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map(([d, short]) => (
                  <label
                    key={d}
                    className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm has-[:checked]:border-volt-400 has-[:checked]:bg-volt-400 has-[:checked]:font-medium has-[:checked]:text-black"
                  >
                    <input
                      type="checkbox"
                      name="weekday"
                      value={d}
                      checked={ticked.includes(d)}
                      onChange={(e) => setDays(e.target.checked ? [...ticked, d].sort() : ticked.filter((x) => x !== d))}
                      className="sr-only"
                    />
                    {short}
                  </label>
                ))}
              </div>
            </div>
            <Field label="Last date" hint="Optional: empty runs until you stop it">
              <input name="endsOn" type="date" min={day} className="input w-auto" />
            </Field>
            <p className="text-xs text-ink-600 sm:col-span-2" role="status">
              {ticked.length && isDay(day)
                ? `Every ${ticked.map((d) => WEEKDAYS[d - 1][2]).join(", ")}, starting ${shortDay(day)}. The first of each goes in the calendar now; fill the rest on the Rota week by week. Change or stop it later on the venue's page.`
                : "Tick at least one day."}
            </p>
          </fieldset>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:col-span-2 lg:col-span-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-ink-950" />
          Tell the act (when confirmed)
        </label>
        <div className="ml-auto flex gap-2">
          <SubmitButton className="btn" pendingText="…" name="mode" value="confirm">
            Add as confirmed
          </SubmitButton>
          <SubmitButton className="btn btn-primary" pendingText="…" name="mode" value="offer">
            Add and offer to act
          </SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}
