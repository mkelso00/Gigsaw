"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { addRotaGig } from "@/actions/slots";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { BOOKING_STATUS_LABELS, EVENT_TYPE_LABELS, EVENT_TYPES } from "@/lib/constants";

type Option = { id: string; name: string };

/** The "New booking" button on every agency page, with a short form in a pop-up. Press "n" to open it. */
export function QuickBooking({
  acts,
  venues,
  contacts,
  currency,
  today,
}: {
  acts: Option[];
  venues: Option[];
  contacts: Option[];
  currency: string;
  today: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [type, setType] = useState("GIG");
  const open = () => ref.current?.showModal();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const field = "input";
  const label = "label";
  return (
    <>
      <button type="button" onClick={open} className="btn btn-volt h-11 shrink-0 rounded-xl px-4" title="New booking (press N)">
        <Icon name="plus" className="h-4 w-4" />
        <span className="hidden sm:inline">New booking</span>
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-2xl border border-ink-200 bg-white p-0 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">New booking</h2>
            <p className="text-sm text-ink-500">The essentials now. Add deal, deposit and itinerary on the booking later.</p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="rounded-lg p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-950"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ActionForm action={addRotaGig} className="grid gap-4 px-6 py-5 sm:grid-cols-2">
          <input type="hidden" name="currency" value={currency} />
          <label className="sm:col-span-2">
            <span className={label}>Act</span>
            <select name="artistId" defaultValue="" autoFocus className={field}>
              <option value="">No act yet (add later)</option>
              {acts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={label}>Date</span>
            <input name="date" type="date" required min={today} defaultValue={today} className={field} />
          </label>
          <label>
            <span className={label}>Venue</span>
            <select name="venueId" defaultValue="" className={field}>
              <option value="">Not set / private venue</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-3 sm:col-span-2">
            <label>
              <span className={label}>Arrive by</span>
              <input name="arriveTime" type="time" className={field} />
            </label>
            <label>
              <span className={label}>On stage</span>
              <input name="startTime" type="time" required defaultValue="19:00" className={field} />
            </label>
            <label>
              <span className={label}>Finish</span>
              <input name="endTime" type="time" required defaultValue="21:00" className={field} />
            </label>
          </div>
          <label>
            <span className={label}>Type</span>
            <select name="eventType" value={type} onChange={(e) => setType(e.target.value)} className={field}>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {EVENT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          {(type === "WEDDING" || type === "PRIVATE_PARTY" || type === "CORPORATE") && (
            <p className="rounded-xl border border-volt-400/60 bg-volt-100 px-3 py-2 text-sm sm:order-last sm:col-span-2">
              Booking several acts for one customer (e.g. ceremony singer, band and DJ)?{" "}
              <Link href="/events/new" onClick={() => ref.current?.close()} className="font-medium underline">
                Create a wedding or event
              </Link>{" "}
              to keep them together with one invoice.
            </p>
          )}
          <label>
            <span className={label}>Status</span>
            <select name="bookingStatus" defaultValue="PENDING" className={field}>
              {(["PENDING", "AWAITING", "CONFIRMED", "HOLD", "ENQUIRY"] as const).map((s) => (
                <option key={s} value={s}>
                  {BOOKING_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              <span className={label}>Sale ({currency})</span>
              <input name="fee" inputMode="decimal" placeholder="0.00" className={field} />
            </label>
            <label>
              <span className={label}>Cost</span>
              <input name="cost" inputMode="decimal" placeholder="Act's fee" className={field} />
            </label>
          </div>
          <label>
            <span className={label}>Booked by</span>
            <select name="promoterId" defaultValue="" className={field}>
              <option value="">Venue&apos;s usual / not set</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <p className="-mt-2 text-xs text-ink-500 sm:col-span-2">
            Pending: in the calendar, act to be sorted. Awaiting confirmation: the act is sent the offer to accept. Confirmed: they&apos;re booked.
          </p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-ink-100 pt-4 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="notify" defaultChecked className="h-4 w-4 accent-ink-950" />
              Tell the act
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="repeat" className="h-4 w-4 accent-ink-950" />
              Every week (needs a venue)
            </label>
            <div className="ml-auto flex items-center gap-2">
              <Link href="/bookings/new" onClick={() => ref.current?.close()} className="btn">
                Full form
              </Link>
              <SubmitButton className="btn btn-primary" pendingText="Booking…">
                Book it
              </SubmitButton>
            </div>
          </div>
        </ActionForm>
      </dialog>
    </>
  );
}
