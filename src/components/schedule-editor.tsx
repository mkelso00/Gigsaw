import type { VenueSlot } from "@prisma/client";
import { createSlots, deleteSlot, stopSlot, updateSlot } from "@/actions/slots";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { BOOKING_STATUS_LABELS, CURRENCIES, EVENT_TYPES, EVENT_TYPE_LABELS, eventTypeLabel } from "@/lib/constants";
import { formatMoney, minorToInput } from "@/lib/money";
import { WEEKDAYS } from "@/lib/rota";

type Option = { id: string; name: string };
type Slot = VenueSlot & { artist: Option | null; booked: number };

/** "1 Jan 2027" for a "YYYY-MM-DD" day. */
const day = (key: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

/** When a slot runs, in words: "from 1 Jan 2027", "until 3 Feb 2027", or nothing for every week. */
function runs(s: Pick<VenueSlot, "startsOn" | "endsOn">, today: string) {
  if (s.endsOn && s.endsOn < today) return `Stopped after ${day(s.endsOn)}`;
  return [s.startsOn && s.startsOn > today ? `From ${day(s.startsOn)}` : "", s.endsOn ? `Last one ${day(s.endsOn)}` : ""].filter(Boolean).join(" · ");
}

function SlotFields({
  slot,
  artists,
  contacts,
  currency,
  today,
}: {
  slot?: VenueSlot;
  artists: Option[];
  contacts: Option[];
  currency: string;
  today: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Field label="Starts on" hint="The first date it runs">
        <input type="date" name="startsOn" defaultValue={slot ? (slot.startsOn ?? "") : today} className="input" />
      </Field>
      <Field label="Last date" hint="Optional: empty runs until you stop it">
        <input type="date" name="endsOn" defaultValue={slot?.endsOn ?? ""} className="input" />
      </Field>
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

/** Stop a slot from a date, and delete it outright when nothing has been booked from it. */
function StopOrDelete({ slot, today }: { slot: Slot; today: string }) {
  const stopped = !!slot.endsOn && slot.endsOn < today;
  return (
    <div className="mt-4 rounded-xl border border-ink-200 p-4">
      <h4 className="text-sm font-medium">{stopped ? "Stopped" : "Stop this weekly slot"}</h4>
      <p className="mt-1 text-xs text-ink-600">
        {stopped
          ? `It ran until ${day(slot.endsOn!)}. To start it again, clear or change the last date above and save.`
          : "It stops showing on the Rota and asking for an act after the last date. Bookings already made stay in the calendar."}
      </p>
      {!stopped && (
        <ActionForm action={stopSlot.bind(null, slot.id)} className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Last date it runs">
            <input type="date" name="endsOn" required defaultValue={slot.endsOn ?? today} min={slot.startsOn ?? undefined} className="input w-auto" />
          </Field>
          <label className="flex max-w-sm items-start gap-2 pb-2 text-sm">
            <input type="checkbox" name="archiveEmpty" defaultChecked className="mt-0.5 h-4 w-4 accent-ink-950" />
            Also archive the bookings it put in the calendar after that date that have no act yet
          </label>
          <SubmitButton className="btn" pendingText="Stopping…">
            Stop it
          </SubmitButton>
        </ActionForm>
      )}
      {slot.booked === 0 ? (
        <ActionForm action={deleteSlot.bind(null, slot.id)} className="mt-3 border-t border-ink-100 pt-3">
          <p className="mb-2 text-xs text-ink-600">Nothing has been booked from it, so it can go completely.</p>
          <ConfirmButton message="Delete this weekly slot? Nothing has been booked from it." className="btn btn-sm btn-danger">
            Delete slot
          </ConfirmButton>
        </ActionForm>
      ) : (
        <p className="mt-3 border-t border-ink-100 pt-3 text-xs text-ink-500">
          {slot.booked} booking{slot.booked === 1 ? " has" : "s have"} been made from it, so it&apos;s stopped rather than deleted.
        </p>
      )}
    </div>
  );
}

/** A venue's weekly music schedule: slots grouped by day, with add, edit, stop and delete. */
export function ScheduleEditor({
  venueId,
  slots,
  artists,
  contacts,
  currency,
  today,
  openSlotId,
}: {
  venueId: string;
  slots: Slot[];
  artists: Option[];
  contacts: Option[];
  currency: string;
  /** Today at the venue, "YYYY-MM-DD". */
  today: string;
  /** A slot to show opened, e.g. from "Stop or change" on the Rota. */
  openSlotId?: string;
}) {
  // Stopped slots stay listed (with their history) but leave the week grid.
  const running = slots.filter((s) => !s.endsOn || s.endsOn >= today);
  return (
    <section id="schedule" className="card card-pad scroll-mt-6">
      <div className="mb-5">
        <h2 className="section-title">Weekly music schedule</h2>
        <p className="mt-1 text-sm text-ink-500">
          The slots that repeat every week at this venue, each from its start date. Fill them week by week on the Rota, or book the regular act for several
          weeks at once.
        </p>
      </div>

      <div className="grid gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 sm:grid-cols-7">
        {WEEKDAYS.map(([d, short]) => {
          const daySlots = running.filter((s) => s.weekday === d).sort((a, b) => a.startTime.localeCompare(b.startTime));
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
                    {runs(s, today) && <div className="mt-0.5 text-[11px] text-amber-800">{runs(s, today)}</div>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {slots.length > 0 && (
        <div className="mt-5 space-y-2">
          <h3 className="text-sm font-medium">Change, stop or delete a slot</h3>
          {[...slots]
            .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))
            .map((s) => (
              <details key={s.id} id={`slot-${s.id}`} open={s.id === openSlotId || undefined} className="scroll-mt-6 rounded-xl border border-ink-200">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span>
                    <strong className="font-medium">Every {WEEKDAYS[s.weekday - 1][2]}</strong> {s.startTime}–{s.endTime} ·{" "}
                    {s.label || eventTypeLabel(s.eventType)}
                    {s.artist ? ` · ${s.artist.name}` : ""}
                    {runs(s, today) && <span className="ml-2 text-xs text-amber-800">{runs(s, today)}</span>}
                  </span>
                  <span className="shrink-0 text-xs text-ink-400">Change</span>
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
                    <SlotFields slot={s} artists={artists} contacts={contacts} currency={currency} today={today} />
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
                  <StopOrDelete slot={s} today={today} />
                </div>
              </details>
            ))}
        </div>
      )}

      <div className="mt-5 rounded-xl border border-dashed border-ink-300">
        <div className="px-4 py-3 text-sm font-medium">Add a weekly slot</div>
        <ActionForm action={createSlots.bind(null, venueId)} className="space-y-4 border-t border-ink-100 p-4">
          <div>
            <span className="label">Every</span>
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
            <span className="hint block">Tick every day it happens, e.g. Mon to Thu 19:00–21:00. Each day becomes its own slot.</span>
          </div>
          <SlotFields artists={artists} contacts={contacts} currency={currency} today={today} />
          <SubmitButton>Add weekly slot</SubmitButton>
        </ActionForm>
      </div>
    </section>
  );
}
