import type { Booking, Settings } from "@prisma/client";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field } from "@/components/ui";
import { MoneyFields } from "@/components/money-fields";
import { BOOKING_STATUSES, BOOKING_STATUS_LABELS, CURRENCIES, EVENT_TYPES, EVENT_TYPE_LABELS, TIMEZONES } from "@/lib/constants";
import type { FormState } from "@/lib/forms";
import { dealBreakdown, minorToInput } from "@/lib/money";
import { localDateKey, localTime } from "@/lib/time";

type Option = { id: string; name: string };

export function BookingForm({
  action,
  booking,
  artists,
  venues,
  promoters,
  agents,
  settings,
  defaults = {},
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  booking?: Booking;
  artists: Option[];
  venues: (Option & { city: string })[];
  promoters: (Option & { company: string })[];
  agents: Option[];
  settings: Settings;
  defaults?: { artistId?: string; venueId?: string; promoterId?: string; date?: string };
}) {
  const tz = booking?.timezone ?? settings.defaultTimezone;
  const t = (d: Date | null | undefined) => (d ? localTime(d, tz) : "");
  const cur = booking?.currency ?? settings.defaultCurrency;

  return (
    <ActionForm action={action} className="space-y-6">
      <section className="card card-pad space-y-4">
        <h2 className="section-title">The booking</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Act" hint="Leave empty while you set the gig up; add the act later">
            <select name="artistId" defaultValue={booking?.artistId ?? defaults.artistId ?? ""} className="input">
              <option value="">No act yet (needs an act)</option>
              {artists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Booking type">
            <select name="eventType" defaultValue={booking?.eventType ?? "GIG"} className="input">
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Event name" hint="Optional, e.g. a festival, tour or the couple's names">
            <input name="eventName" defaultValue={booking?.eventName} className="input" />
          </Field>
          <Field label="Status" hint="Awaiting confirmation sends the act an offer to accept or decline">
            <select name="status" defaultValue={booking?.status ?? "PENDING"} className="input">
              {BOOKING_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {BOOKING_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Agent">
            <select name="agentId" defaultValue={booking?.agentId ?? ""} className="input">
              <option value="">Me</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Venue" hint={venues.length ? "The venue's time zone is used for all times" : "Add venues under Venues"}>
            <select name="venueId" defaultValue={booking?.venueId ?? defaults.venueId ?? ""} className="input">
              <option value="">No venue yet</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                  {v.city ? `, ${v.city}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Who pays"
            hint={
              <>
                The venue&apos;s company, or the couple or client for weddings and parties.{" "}
                <a href="/contacts/new?type=CLIENT" target="_blank" className="underline">
                  Add a private customer
                </a>
              </>
            }
          >
            <select name="promoterId" defaultValue={booking?.promoterId ?? defaults.promoterId ?? ""} className="input">
              <option value="">Not set yet</option>
              {promoters.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.company ? ` (${p.company})` : ""}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-4 hover:border-ink-300">
          <input
            type="checkbox"
            name="notifyClientOnArrival"
            defaultChecked={booking?.notifyClientOnArrival ?? true}
            className="mt-0.5 h-4 w-4 accent-ink-950"
          />
          <span>
            <span className="block text-sm font-medium">Tell the client when the act arrives</span>
            <span className="block text-xs text-ink-500">
              Sends them a short email and text when the artist checks in. Good for weddings and private events.
            </span>
          </span>
        </label>
      </section>

      <section className="card card-pad space-y-4">
        <div>
          <h2 className="section-title">Times</h2>
          <p className="text-sm text-slate-500">
            Use the venue&apos;s local time. Times after midnight roll into the next day automatically. The <strong>arrive by</strong> time is what arrival
            tracking measures against.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Field label="Date" className="sm:col-span-1 lg:col-span-2">
            <input type="date" name="date" required defaultValue={booking ? localDateKey(booking.arriveBy, tz) : defaults.date} className="input" />
          </Field>
          <Field label="Arrive by">
            <input type="time" name="arriveTime" required defaultValue={t(booking?.arriveBy) || "17:00"} className="input" />
          </Field>
          <Field label="Soundcheck">
            <input type="time" name="soundcheckTime" defaultValue={t(booking?.soundcheckAt)} className="input" />
          </Field>
          <Field label="On stage">
            <input type="time" name="setStartTime" required defaultValue={t(booking?.setStart) || "20:00"} className="input" />
          </Field>
          <Field label="Off stage">
            <input type="time" name="setEndTime" defaultValue={t(booking?.setEnd)} className="input" />
          </Field>
        </div>
        <Field label="Time zone (only used when no venue is chosen)" className="max-w-xs">
          <select name="timezone" defaultValue={tz} className="input">
            {TIMEZONES.map((z) => (
              <option key={z} value={z}>
                {z.replace("_", " ")}
              </option>
            ))}
          </select>
        </Field>
      </section>

      <section className="card card-pad space-y-4">
        <h2 className="section-title">Money</h2>
        <MoneyFields
          currency={cur}
          currencies={CURRENCIES}
          sale={minorToInput(booking?.feeMinor, cur)}
          cost={booking ? minorToInput(booking.dealType === "BUY_SELL" ? booking.artistFeeMinor : dealBreakdown(booking).artistMinor, cur) : ""}
          vatPct={booking?.vatPct ?? 0}
          bookingFee={booking ? minorToInput(booking.bookingFeeMinor || null, cur) : ""}
          feeDefaults={booking ? undefined : { bookingFeeMinor: settings.bookingFeeMinor, bookingFeeFor: settings.bookingFeeFor }}
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Deposit">
            <input name="deposit" inputMode="decimal" defaultValue={minorToInput(booking?.depositMinor, cur)} placeholder="0.00" className="input" />
          </Field>
          <Field label="Deposit due">
            <input type="date" name="depositDueDate" defaultValue={booking?.depositDueDate ? localDateKey(booking.depositDueDate, tz) : ""} className="input" />
          </Field>
        </div>
        <Field label="Money notes" hint="Anything extra agreed, e.g. food, parking, extra set">
          <textarea name="dealNotes" rows={2} defaultValue={booking?.dealNotes} className="input" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Radius clause (km)">
            <input name="radiusKm" inputMode="numeric" defaultValue={booking?.radiusKm ?? ""} className="input" />
          </Field>
          <Field label="Radius clause (days either side)">
            <input name="radiusDays" inputMode="numeric" defaultValue={booking?.radiusDays ?? ""} className="input" />
          </Field>
        </div>
      </section>

      <section className="card card-pad space-y-4">
        <div>
          <h2 className="section-title">Itinerary</h2>
          <p className="text-sm text-slate-500">The artist sees this in their app.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Travel">
            <textarea name="travel" rows={3} defaultValue={booking?.travel} placeholder="Trains, flights, pick-ups" className="input" />
          </Field>
          <Field label="Accommodation">
            <textarea name="accommodation" rows={3} defaultValue={booking?.accommodation} className="input" />
          </Field>
          <Field label="Day of show contact">
            <textarea name="dayContact" rows={2} defaultValue={booking?.dayContact} placeholder="Name and phone number" className="input" />
          </Field>
          <Field label="Hospitality and rider notes">
            <textarea name="hospitality" rows={2} defaultValue={booking?.hospitality} className="input" />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Internal notes" hint="Not shown to the artist">
            <textarea name="notes" rows={3} defaultValue={booking?.notes} className="input" />
          </Field>
          <Field label="Tags" hint="Comma separated, e.g. festival, private">
            <input name="tags" defaultValue={booking?.tags} className="input" />
          </Field>
        </div>
      </section>

      {booking && (
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-volt-400 bg-volt-100/60 p-4">
          <input type="checkbox" name="notifyArtist" defaultChecked className="mt-0.5 h-4 w-4 accent-ink-950" />
          <span>
            <span className="block text-sm font-medium">Let the artist know what changed</span>
            <span className="block text-xs text-ink-600">If the date, times, venue or their fee change, they get an email and text showing old and new.</span>
          </span>
        </label>
      )}

      <div className="flex justify-end">
        <SubmitButton>{booking ? "Save changes" : "Create booking"}</SubmitButton>
      </div>
    </ActionForm>
  );
}
