import type { Booking, Settings } from "@prisma/client";
import { Combobox } from "@/components/combobox";
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
  /** Starting values for a new booking, e.g. from the calendar or an act who said they're free. */
  defaults?: {
    artistId?: string;
    venueId?: string;
    promoterId?: string;
    date?: string;
    arriveTime?: string;
    setStartTime?: string;
    setEndTime?: string;
    eventType?: string;
    cost?: string;
  };
}) {
  const tz = booking?.timezone ?? settings.defaultTimezone;
  const t = (d: Date | null | undefined) => (d ? localTime(d, tz) : "");
  const cur = booking?.currency ?? settings.defaultCurrency;

  return (
    <ActionForm action={action} className="space-y-6">
      <section className="card card-pad space-y-4">
        <h2 className="section-title">The booking</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Act" htmlFor="bf-act" hint="Leave empty while you set the gig up; add the act later">
            <Combobox
              id="bf-act"
              name="artistId"
              options={artists}
              defaultValue={booking?.artistId ?? defaults.artistId ?? ""}
              emptyLabel="No act yet (needs an act)"
              placeholder="Type an act's name"
            />
          </Field>
          <Field label="Booking type">
            <select name="eventType" defaultValue={booking?.eventType ?? defaults.eventType ?? "GIG"} className="input">
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
          <Field label="Lead agent" hint="The internal user looking after it">
            <select name="agentId" defaultValue={booking?.agentId ?? ""} className="input">
              <option value="">Me</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Venue" htmlFor="bf-venue" hint={venues.length ? "The venue's time zone is used for all times" : "Add venues under Venues"}>
            <Combobox
              id="bf-venue"
              name="venueId"
              options={venues.map((v) => ({ id: v.id, name: v.name, detail: v.city }))}
              defaultValue={booking?.venueId ?? defaults.venueId ?? ""}
              emptyLabel="No venue yet"
              placeholder="Type a venue or town"
            />
          </Field>
          <Field
            label="Who pays"
            htmlFor="bf-payer"
            hint={
              <>
                The venue&apos;s company, or the couple or client for weddings and parties.{" "}
                <a href="/contacts/new?type=CLIENT" target="_blank" className="underline">
                  Add a private customer
                </a>
              </>
            }
          >
            <Combobox
              id="bf-payer"
              name="promoterId"
              options={promoters.map((p) => ({ id: p.id, name: p.name, detail: p.company }))}
              defaultValue={booking?.promoterId ?? defaults.promoterId ?? ""}
              emptyLabel="Not set yet"
              placeholder="Type a company or customer"
            />
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
            <input type="time" name="arriveTime" required defaultValue={t(booking?.arriveBy) || defaults.arriveTime || "17:00"} className="input" />
          </Field>
          <Field label="Soundcheck">
            <input type="time" name="soundcheckTime" defaultValue={t(booking?.soundcheckAt)} className="input" />
          </Field>
          <Field label="On stage">
            <input type="time" name="setStartTime" required defaultValue={t(booking?.setStart) || defaults.setStartTime || "20:00"} className="input" />
          </Field>
          <Field label="Off stage">
            <input type="time" name="setEndTime" defaultValue={t(booking?.setEnd) || defaults.setEndTime} className="input" />
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
          cost={
            booking ? minorToInput(booking.dealType === "BUY_SELL" ? booking.artistFeeMinor : dealBreakdown(booking).artistMinor, cur) : (defaults.cost ?? "")
          }
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
