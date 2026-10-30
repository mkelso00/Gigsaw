import type { VenueSlot } from "@prisma/client";
import { createSlots, deleteSlot, updateSlot } from "@/actions/slots";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { BOOKING_STATUS_LABELS, CURRENCIES, EVENT_TYPES, EVENT_TYPE_LABELS, eventTypeLabel } from "@/lib/constants";
import { formatMoney, minorToInput } from "@/lib/money";
import { WEEKDAYS } from "@/lib/rota";

type Option = { id: string; name: string };

function SlotFields({ slot, artists, contacts, currency }: { slot?: VenueSlot; artists: Option[]; contacts: Option[]; currency: string }) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Field label="Act / label" hint="e.g. Solo, Duo, DJ">
        <input name="label" defaultValue={slot?.label ?? "Solo"} className="input" />
      </Field>
      <Field label="Arrive by" hint="Blank = 30 min before">
        <input type="time" name="arriveTime" defaultValue={slot?.arriveTime} className="input" />
      </Field>
      <Field label="Start">
        <input type="time" name="startTime" required defaultValue={slot?.startTime ?? "19:00"} className="input" />
      </Field>
      <Field label="Finish">
        <input type="time" name="endTime" required defaultValue={slot?.endTime ?? "21:00"} className="input" />
      </Field>
      <Field label="Sale" hint="What the venue pays">
        <input name="fee" inputMode="decimal" defaultValue={slot ? minorToInput(slot.feeMinor, slot.currency) : ""} placeholder="150.00" className="input" />
      </Field>
      <Field label="Cost" hint="The act's fee. Blank = commission">
        <input
          name="cost"
          inputMode="decimal"
          defaultValue={slot?.costMinor != null ? minorToInput(slot.costMinor, slot.currency) : ""}
          placeholder="120.00"
          className="input"
        />
      </Field>
      <Field label="Currency">
        <select name="currency" defaultValue={slot?.currency ?? currency} className="input">
          {CURRENCIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </Field>
      <Field label="Regular act" hint="Used by “book regulars”">
        <select name="artistId" defaultValue={slot?.artistId ?? ""} className="input">
          <option value="">None, fill each week</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Who pays">
        <select name="promoterId" defaultValue={slot?.promoterId ?? ""} className="input">
          <option value="">Not set</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Booking type">
        <select name="eventType" defaultValue={slot?.eventType ?? "GIG"} className="input">
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {EVENT_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Book as">
        <select name="bookingStatus" defaultValue={slot?.bookingStatus ?? "CONFIRMED"} className="input">
          {(["CONFIRMED", "PENDING", "HOLD"] as const).map((s) => (
            <option key={s} value={s}>
              {BOOKING_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

/** A venue's weekly music schedule: slots grouped by day, with add and edit forms. */
export function ScheduleEditor({
  venueId,
  slots,
  artists,
  contacts,
  currency,
}: {
  venueId: string;
  slots: (VenueSlot & { artist: Option | null })[];
  artists: Option[];
  contacts: Option[];
  currency: string;
}) {
  return (
    <section className="card card-pad">
      <div className="mb-5">
        <h2 className="section-title">Weekly music schedule</h2>
        <p className="mt-1 text-sm text-ink-500">
          The regular slots at this venue. Fill them week by week on the Rota, or book the regular artist for several weeks at once.
        </p>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 sm:grid-cols-7">
        {WEEKDAYS.map(([d, short]) => {
          const daySlots = slots.filter((s) => s.weekday === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
          return (
            <div key={d} className="min-h-24 bg-white p-2.5">
              <div className="mb-2 text-xs font-medium text-ink-500">{short}</div>
              <div className="space-y-1.5">
                {daySlots.length === 0 && <div className="text-xs text-ink-300">No music</div>}
                {daySlots.map((s) => (
                  <div key={s.id} className="rounded-lg bg-ink-50 px-2 py-1.5 text-xs">
                    <div className="font-semibold tabular-nums">
                      {s.startTime}–{s.endTime}
                    </div>
                    <div className="text-ink-500">
                      {s.label || eventTypeLabel(s.eventType)}
                      {s.feeMinor ? ` · ${formatMoney(s.feeMinor, s.currency)}` : ""}
                    </div>
                    {s.artist && <div className="mt-0.5 truncate text-ink-700">{s.artist.name}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {slots.length > 0 && (
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-medium">Edit a slot</h3>
          {[...slots]
            .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
            .map((s) => (
              <details key={s.id} className="rounded-xl border border-ink-200">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm">
                  <span>
                    <strong className="font-medium">{WEEKDAYS[s.weekday - 1][2]}</strong> {s.startTime}–{s.endTime} · {s.label || eventTypeLabel(s.eventType)}
                    {s.artist ? ` · ${s.artist.name}` : ""}
                  </span>
                  <span className="text-xs text-ink-400">Edit</span>
                </summary>
                <div className="border-t border-ink-100 p-4">
                  <ActionForm action={updateSlot.bind(null, s.id)} className="space-y-4">
                    <Field label="Day" className="max-w-48">
                      <select name="weekday" defaultValue={s.weekday} className="input">
                        {WEEKDAYS.map(([d, , long]) => (
                          <option key={d} value={d}>
                            {long}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <SlotFields slot={s} artists={artists} contacts={contacts} currency={currency} />
                    <label className="flex items-start gap-3 rounded-xl border border-volt-400 bg-volt-100/60 p-3 text-sm">
                      <input type="checkbox" name="applyToUpcoming" defaultChecked className="mt-0.5 h-4 w-4 accent-ink-950" />
                      <span>
                        <span className="block font-medium">Also change bookings already booked in this slot from today on</span>
                        <span className="block text-xs text-ink-600">New times and fee are applied to each upcoming booking.</span>
                      </span>
                    </label>
                    <label className="flex items-center gap-3 px-3 text-sm">
                      <input type="checkbox" name="notifyArtists" defaultChecked className="h-4 w-4 accent-ink-950" />
                      Tell the artists what changed
                    </label>
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton>Save slot</SubmitButton>
                    </div>
                  </ActionForm>
                  <form action={deleteSlot.bind(null, s.id)} className="mt-3">
                    <ConfirmButton message="Remove this slot? Bookings already booked in it stay booked." className="btn btn-sm btn-danger">
                      Remove slot
                    </ConfirmButton>
                  </form>
                </div>
              </details>
            ))}
        </div>
      )}

      <div className="mt-5 rounded-xl border border-dashed border-ink-300">
        <div className="px-4 py-3 text-sm font-medium">Add a slot</div>
        <ActionForm action={createSlots.bind(null, venueId)} className="space-y-4 border-t border-ink-100 p-4">
          <div>
            <span className="label">Days</span>
            <div className="flex flex-wrap gap-2">
              {WEEKDAYS.map(([d, short]) => (
                <label
                  key={d}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm has-[:checked]:border-volt-400 has-[:checked]:bg-volt-400 has-[:checked]:font-medium has-[:checked]:text-black"
                >
                  <input type="checkbox" name="weekday" value={d} className="sr-only" />
                  {short}
                </label>
              ))}
            </div>
            <span className="hint block">Tick every day with the same slot, e.g. Mon to Thu 19:00–21:00.</span>
          </div>
          <SlotFields artists={artists} contacts={contacts} currency={currency} />
          <SubmitButton>Add slot</SubmitButton>
        </ActionForm>
      </div>
    </section>
  );
}
