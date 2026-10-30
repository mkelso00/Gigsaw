"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { createAvailabilityRequest } from "@/actions/availability";
import { ActPicker, type PickableAct } from "@/components/act-picker";
import { Combobox, type ComboOption } from "@/components/combobox";
import { ActionForm, SubmitButton } from "@/components/forms";
import { EVENT_TYPE_LABELS, EVENT_TYPES } from "@/lib/constants";

export type AvailabilityDefaults = {
  date: string;
  arriveTime?: string;
  startTime?: string;
  endTime?: string;
  venueId?: string;
  place?: string;
  eventType?: string;
  cost?: string;
  note?: string;
  bookingId?: string;
  actIds?: string[];
};

/**
 * "Who's free?": a date, optional times and place, and the acts to ask. Changing the date
 * reloads which acts are away or already booked that day, keeping everything typed so far.
 */
export function AvailabilityForm({
  acts,
  venues,
  currency,
  today,
  defaults,
}: {
  acts: PickableAct[];
  venues: ComboOption[];
  currency: string;
  today: string;
  defaults: AvailabilityDefaults;
}) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [date, setDate] = useState(defaults.date);
  const [venueId, setVenueId] = useState(defaults.venueId ?? "");
  return (
    <ActionForm action={createAvailabilityRequest} className="space-y-6">
      {defaults.bookingId && <input type="hidden" name="bookingId" value={defaults.bookingId} />}
      <section className="card card-pad space-y-4">
        <h2 className="section-title">When and where</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label>
            <span className="label">Date</span>
            <input
              type="date"
              name="date"
              required
              min={today}
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) {
                  const q = new URLSearchParams(params.toString());
                  q.set("date", e.target.value);
                  router.replace(`${path}?${q}`, { scroll: false });
                }
              }}
              className="input"
            />
          </label>
          <label>
            <span className="label">Type</span>
            <select name="eventType" defaultValue={defaults.eventType ?? "GIG"} className="input">
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <div>
            <label htmlFor="av-venue" className="label">
              Venue
            </label>
            <Combobox
              id="av-venue"
              name="venueId"
              options={venues}
              defaultValue={defaults.venueId}
              emptyLabel="No venue on file"
              placeholder="Type a venue or town"
              onChange={setVenueId}
            />
          </div>
          {!venueId && (
            <label>
              <span className="label">Where (optional)</span>
              <input name="place" defaultValue={defaults.place} placeholder="e.g. Wedding near York" className="input" />
            </label>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="col-span-2 sm:col-span-1">
            <span className="label">Arrive by</span>
            <input name="arriveTime" type="time" defaultValue={defaults.arriveTime} className="input" />
          </label>
          <label>
            <span className="label">On stage</span>
            <input name="startTime" type="time" defaultValue={defaults.startTime} className="input" />
          </label>
          <label>
            <span className="label">Finish</span>
            <input name="endTime" type="time" defaultValue={defaults.endTime} className="input" />
          </label>
        </div>
        <p className="-mt-2 text-xs text-ink-500">Times are optional. With an on stage time, a Yes can be booked in one click.</p>
        <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
          <label>
            <span className="label">Act&apos;s fee ({currency})</span>
            <input name="cost" inputMode="decimal" defaultValue={defaults.cost} placeholder="Optional" className="input" />
          </label>
          <label>
            <span className="label">Note for the acts (optional)</span>
            <input name="note" defaultValue={defaults.note} maxLength={1000} placeholder="e.g. Two 45 minute sets, acoustic" className="input" />
          </label>
        </div>
        <p className="-mt-2 text-xs text-ink-500">Acts see the date, times, place, note and their fee. They never see what the venue or customer pays.</p>
      </section>

      <section className="card card-pad space-y-3">
        <div>
          <h2 className="section-title">Acts to ask</h2>
          <p className="text-sm text-ink-500">Each act is sent the question by email, phone notification or text, with a link to answer Yes or No.</p>
        </div>
        <ActPicker acts={acts} defaultIds={defaults.actIds} />
      </section>

      <div className="flex justify-end">
        <SubmitButton className="btn btn-primary w-full sm:w-auto" pendingText="Sending…">
          Ask if they&apos;re free
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
