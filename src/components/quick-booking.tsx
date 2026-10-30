"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addRotaGig } from "@/actions/slots";
import { Combobox, type ComboOption } from "@/components/combobox";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { awayLine, awayOn, type AwayBlock } from "@/lib/availability";
import { BOOKING_STATUS_LABELS, EVENT_TYPE_LABELS, EVENT_TYPES } from "@/lib/constants";

/**
 * The "New booking" button on every agency page, with a short form in a pop-up. Press "n" to open it.
 * Act, venue and who pays are type-to-search. Ctrl+Enter (or Enter in a box) books it; after a
 * booking the form clears and goes back to Act, ready for the next one.
 */
export function QuickBooking({
  acts,
  venues,
  contacts,
  currency,
  today,
  away = [],
}: {
  acts: ComboOption[];
  venues: ComboOption[];
  contacts: ComboOption[];
  currency: string;
  today: string;
  /** Days acts have blocked out, from today on (a band's list includes its acts' days). */
  away?: (AwayBlock & { own: boolean; actName: string })[];
}) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const actRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState("GIG");
  const [actId, setActId] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [date, setDate] = useState(today);
  // Acts away on the chosen date are marked, not hidden: the agent may know better.
  const awayToday = useMemo(() => awayOn(away, date), [away, date]);
  const actOptions = useMemo(
    () => acts.map((a) => (awayToday.has(a.id) ? { ...a, badge: "Away", badgeTitle: awayLine(a.name, awayToday.get(a.id)!) } : a)),
    [acts, awayToday],
  );
  const chosenAway = actId && awayToday.has(actId) ? awayLine(acts.find((a) => a.id === actId)?.name ?? "This act", awayToday.get(actId)!) : null;
  const open = () => {
    ref.current?.showModal();
    actRef.current?.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener("keydown", onKey);
    // The phone top bar's + icon.
    window.addEventListener("gigsaw:new-booking", open);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("gigsaw:new-booking", open);
    };
  }, []);

  // The form clears itself after a booking: put the controlled bits back too and start again at Act.
  const formBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = formBox.current?.querySelector("form");
    if (!form) return;
    const onReset = () => {
      setType("GIG");
      setStatus("PENDING");
      setDate(today);
      setTimeout(() => actRef.current?.focus(), 0);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [today]);
  const onActChange = useCallback((id: string) => setActId(id), []);

  const field = "input";
  const label = "label";
  const noAct = !actId;
  return (
    <>
      <button type="button" onClick={open} className="btn btn-volt hidden h-11 shrink-0 rounded-xl px-4 lg:inline-flex" title="New booking (press N)">
        <Icon name="plus" className="h-4 w-4" />
        <span className="hidden sm:inline">New booking</span>
      </button>
      <dialog
        ref={ref}
        aria-labelledby="quick-booking-title"
        className="m-auto w-[min(640px,calc(100vw-2rem))] rounded-2xl border border-ink-200 bg-white p-0 shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-ink-100 px-5 py-4 sm:px-6">
          <div>
            <h2 id="quick-booking-title" className="text-lg font-semibold tracking-tight">
              New booking
            </h2>
            <p className="text-sm text-ink-500">The essentials now. Add deposit and itinerary on the booking later.</p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            className="-mr-2 rounded-lg p-2 text-ink-400 hover:bg-ink-50 hover:text-ink-950"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div
          ref={formBox}
          onKeyDown={(e) => {
            // Ctrl+Enter (Cmd+Enter on a Mac) books it from any field.
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              formBox.current?.querySelector("form")?.requestSubmit();
            }
          }}
        >
          <ActionForm action={addRotaGig} className="grid gap-4 px-5 py-5 sm:grid-cols-2 sm:px-6">
            <input type="hidden" name="currency" value={currency} />
            <div className="sm:col-span-2">
              <label htmlFor="qb-act" className={label}>
                Act
              </label>
              <Combobox
                id="qb-act"
                name="artistId"
                options={actOptions}
                emptyLabel="No act yet (add later)"
                placeholder="Type an act's name"
                inputRef={actRef}
                onChange={onActChange}
                aria-describedby={chosenAway ? "qb-away" : undefined}
              />
              {chosenAway && (
                <p id="qb-away" role="status" className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  {chosenAway} You can still book them.
                </p>
              )}
            </div>
            <label>
              <span className={label}>Date</span>
              <input name="date" type="date" required min={today} defaultValue={today} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <div>
              <label htmlFor="qb-venue" className={label}>
                Venue
              </label>
              <Combobox id="qb-venue" name="venueId" options={venues} emptyLabel="No venue (e.g. a private address)" placeholder="Type a venue or town" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3">
              <label className="col-span-2 sm:col-span-1">
                <span className={label}>Arrive by</span>
                <input name="arriveTime" type="time" className={field} aria-describedby="qb-arrive-hint" />
              </label>
              <label>
                <span className={label}>On stage</span>
                <input name="startTime" type="time" required defaultValue="19:00" className={field} />
              </label>
              <label>
                <span className={label}>Finish</span>
                <input name="endTime" type="time" required defaultValue="21:00" className={field} />
              </label>
              <p id="qb-arrive-hint" className="col-span-2 -mt-2 text-xs text-ink-500 sm:col-span-3">
                Leave Arrive by empty for 30 minutes before they&apos;re on stage.
              </p>
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
              <select name="bookingStatus" value={status} onChange={(e) => setStatus(e.target.value)} className={field} aria-describedby="qb-status-hint">
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
            <div>
              <label htmlFor="qb-payer" className={label}>
                Who pays
              </label>
              <Combobox id="qb-payer" name="promoterId" options={contacts} emptyLabel="The venue's usual payer" placeholder="Type a company or customer" />
            </div>
            <p id="qb-status-hint" className="-mt-2 text-xs text-ink-500 sm:col-span-2">
              {noAct && status !== "PENDING" && status !== "ENQUIRY"
                ? "No act yet, so it's saved as Pending. Add the act later and change the status then."
                : status === "AWAITING"
                  ? "Awaiting confirmation: the act is sent the offer to accept or decline."
                  : status === "CONFIRMED"
                    ? "Confirmed: the act is booked."
                    : status === "PENDING"
                      ? "Pending: in the calendar, act to be sorted."
                      : status === "HOLD"
                        ? "On hold: pencilled in while it's agreed."
                        : "Enquiry: someone's asking, nothing agreed yet."}
            </p>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-ink-100 pt-4 sm:col-span-2">
              <label className={`flex items-center gap-2 text-sm ${noAct ? "text-ink-400" : ""}`} title={noAct ? "Choose an act first" : undefined}>
                <input type="checkbox" name="notify" defaultChecked disabled={noAct} className="h-4 w-4 accent-ink-950" />
                Tell the act
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="repeat" className="h-4 w-4 accent-ink-950" />
                Every week (needs a venue)
              </label>
              <div className="ml-auto flex items-center gap-2">
                <Link
                  href="/bookings/new"
                  onClick={(e) => {
                    // Take what's been chosen so far across to the full form.
                    const form = formBox.current?.querySelector("form");
                    if (form) {
                      e.preventDefault();
                      const data = new FormData(form);
                      const q = new URLSearchParams();
                      for (const k of ["artistId", "venueId", "promoterId", "date"]) {
                        const v = data.get(k);
                        if (typeof v === "string" && v) q.set(k, v);
                      }
                      router.push(`/bookings/new${q.size ? `?${q}` : ""}`);
                    }
                    ref.current?.close();
                  }}
                  className="btn"
                >
                  Full form
                </Link>
                <SubmitButton className="btn btn-primary" pendingText="Booking…">
                  Book it
                </SubmitButton>
              </div>
              <p className="hidden w-full text-right text-xs text-ink-400 sm:block">
                <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">Enter</kbd> to book, <kbd className="font-sans">Esc</kbd> to close
              </p>
            </div>
          </ActionForm>
        </div>
      </dialog>
    </>
  );
}
