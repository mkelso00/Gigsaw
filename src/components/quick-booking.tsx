"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadQuickBookingLists, type QuickBookingLists } from "@/actions/quick-booking";
import { addRotaGig } from "@/actions/slots";
import { Combobox } from "@/components/combobox";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Icon } from "@/components/icons";
import { awayLine, awayOn } from "@/lib/availability";
import { BOOKING_STATUS_LABELS, EVENT_TYPE_LABELS, EVENT_TYPES } from "@/lib/constants";

// One empty list for while the real ones load, so the pickers' memos don't rerun on every render.
const NONE: never[] = [];

/**
 * The "New booking" button on every agency page, with a short form in a pop-up. Press "n" to open it.
 * Act, venue and who pays are type-to-search. Ctrl+Enter (or Enter in a box) books it; after a
 * booking the form clears and goes back to Act, ready for the next one.
 *
 * The acts, venues and contacts to pick from are loaded the first time it opens (or the button is
 * pointed at), then kept. `version` changes whenever the server sends the layout again (after a save
 * or a refresh), so the next opening fetches them afresh and picks up anything added since.
 */
export function QuickBooking({ currency, today, version }: { currency: string; today: string; version: string }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const actRef = useRef<HTMLInputElement>(null);
  const [lists, setLists] = useState<QuickBookingLists | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const versionRef = useRef(version);
  const loads = useRef<{ version: string | null; pending: boolean }>({ version: null, pending: false });
  // Stable, so the keyboard shortcut's listener (added once) can call it.
  const load = useCallback(() => {
    const v = versionRef.current;
    if (loads.current.pending || loads.current.version === v) return;
    loads.current.pending = true;
    setLoadFailed(false);
    loadQuickBookingLists()
      .then((l) => {
        loads.current.version = v;
        setLists(l);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => {
        loads.current.pending = false;
      });
  }, []);
  useEffect(() => {
    versionRef.current = version;
    // Booked one with the pop-up still open: bring its lists up to date straight away.
    if (ref.current?.open) load();
  }, [version, load]);
  const acts = lists?.acts ?? NONE;
  const away = lists?.away ?? NONE;
  const [type, setType] = useState("GIG");
  const [actId, setActId] = useState("");
  const [status, setStatus] = useState("PENDING");
  const [date, setDate] = useState(today);
  // Normally from today on; a past day picked on the calendar is allowed too (logging a gig that happened).
  const [minDate, setMinDate] = useState(today);
  // Acts away on the chosen date are marked, not hidden: the agent may know better.
  const awayToday = useMemo(() => awayOn(away, date), [away, date]);
  const actOptions = useMemo(
    () => acts.map((a) => (awayToday.has(a.id) ? { ...a, badge: "Away", badgeTitle: awayLine(a.name, awayToday.get(a.id)!) } : a)),
    [acts, awayToday],
  );
  const chosenAway = actId && awayToday.has(actId) ? awayLine(acts.find((a) => a.id === actId)?.name ?? "This act", awayToday.get(actId)!) : null;
  const open = (e?: Event) => {
    load();
    // A day square on the calendar sends its date along.
    const picked = (e as CustomEvent<{ date?: string }> | undefined)?.detail?.date;
    if (picked && /^\d{4}-\d{2}-\d{2}$/.test(picked)) {
      const input = formBox.current?.querySelector<HTMLInputElement>('input[name="date"]');
      setMinDate(picked < today ? picked : today);
      if (input) input.value = picked;
      setDate(picked);
    }
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
      setMinDate(today);
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
      <button
        type="button"
        onClick={() => open()}
        onPointerEnter={load}
        onFocus={load}
        className="btn btn-volt hidden h-11 shrink-0 rounded-xl px-4 lg:inline-flex"
        title="New booking (press N)"
      >
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
              {!lists &&
                (loadFailed ? (
                  <p role="alert" className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Couldn&apos;t load your acts, venues and contacts.{" "}
                    <button type="button" onClick={load} className="font-medium underline">
                      Try again
                    </button>
                  </p>
                ) : (
                  <p role="status" className="mt-1.5 text-xs text-ink-500">
                    Loading acts, venues and contacts…
                  </p>
                ))}
            </div>
            <label>
              <span className={label}>Date</span>
              <input name="date" type="date" required min={minDate} defaultValue={today} onChange={(e) => setDate(e.target.value)} className={field} />
            </label>
            <div>
              <label htmlFor="qb-venue" className={label}>
                Venue
              </label>
              <Combobox
                id="qb-venue"
                name="venueId"
                options={lists?.venues ?? NONE}
                emptyLabel="No venue (e.g. a private address)"
                placeholder="Type a venue or town"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:col-span-2 sm:grid-cols-3">
              <label>
                <span className={label}>Start</span>
                <input name="startTime" type="time" required defaultValue="19:00" className={field} />
              </label>
              <label>
                <span className={label}>Finish</span>
                <input name="endTime" type="time" required defaultValue="21:00" className={field} />
              </label>
              <label className="col-span-2 sm:col-span-1">
                <span className={label}>Arrive by (optional)</span>
                <input name="arriveTime" type="time" className={field} aria-describedby="qb-arrive-hint" />
              </label>
              <p id="qb-arrive-hint" className="col-span-2 -mt-2 text-xs text-ink-500 sm:col-span-3">
                Only for an early arrival, like a wedding or an opening. Left empty, it&apos;s 30 minutes before the start.
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
                <span className={label}>Cost ({currency})</span>
                <input name="cost" inputMode="decimal" placeholder="Act's fee" className={field} />
              </label>
              <label>
                <span className={label}>Sale ({currency})</span>
                <input name="fee" inputMode="decimal" placeholder="They pay" className={field} />
              </label>
            </div>
            <div>
              <label htmlFor="qb-payer" className={label}>
                Who pays (optional)
              </label>
              <Combobox
                id="qb-payer"
                name="promoterId"
                options={lists?.contacts ?? NONE}
                emptyLabel="The venue's usual payer"
                placeholder="Type a company or customer"
              />
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
