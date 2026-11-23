"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { copyBooking, type CopyResult } from "@/actions/bookings";
import { MAX_COPY_DATES } from "@/lib/constants";
import { addDaysToKey } from "@/lib/time";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const shortDate = (k: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${k}T12:00:00Z`));

/**
 * "Copy" on a booking: pick any number of dates on a mini calendar and the booking is copied to
 * each, or tick off the same day every week for a number of weeks in one go (a weekly residency
 * can run to hundreds of dates). With one date you can jump to the new booking; with several you
 * stay where you are.
 */
export function CopyBooking({
  bookingId,
  startDate,
  today,
  hasAct,
  actName,
}: {
  bookingId: string;
  startDate: string;
  today: string;
  hasAct: boolean;
  actName: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [month, setMonth] = useState(() => {
    const [y, m] = startDate.split("-").map(Number);
    return { y, m: m - 1 };
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("PENDING");
  const [keepAct, setKeepAct] = useState(true);
  const [result, setResult] = useState<CopyResult | null>(null);
  const [pending, start] = useTransition();
  const [weeks, setWeeks] = useState("12");
  // The same day each week after this booking (or from today, for an old one), for that many weeks.
  const pickWeekly = () => {
    const n = Math.min(Math.max(Math.floor(Number(weeks)) || 0, 1), MAX_COPY_DATES);
    let first = addDaysToKey(startDate, 7);
    while (first < today) first = addDaysToKey(first, 7);
    const dates = Array.from({ length: n }, (_, i) => addDaysToKey(first, i * 7));
    setPicked((p) => new Set([...p, ...dates]));
  };
  const tooMany = picked.size > MAX_COPY_DATES;
  const last = picked.size ? [...picked].sort().at(-1)! : null;

  const cells = useMemo(() => {
    const first = new Date(Date.UTC(month.y, month.m, 1));
    const lead = (first.getUTCDay() + 6) % 7;
    const days = new Date(Date.UTC(month.y, month.m + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  }, [month]);
  const title = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(month.y, month.m, 1)));
  const toggle = (k: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const shift = (by: number) => setMonth(({ y, m }) => ({ y: m + by < 0 ? y - 1 : m + by > 11 ? y + 1 : y, m: (m + by + 12) % 12 }));
  const close = () => {
    ref.current?.close();
    setResult(null);
    setPicked(new Set());
  };

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <button type="button" className="btn" onClick={() => ref.current?.showModal()}>
        Copy
      </button>
      {/* In document.body: on a phone the Copy button sits in the "⋯" menu, which closes (and
          would hide the pop-up with it) as soon as the button is tapped. */}
      {mounted &&
        createPortal(
          <dialog
            ref={ref}
            className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-ink-200 bg-white p-0 shadow-2xl backdrop:bg-black/60"
            onClick={(e) => e.target === ref.current && close()}
          >
            <div className="border-b border-ink-100 px-5 py-4">
              <h2 className="text-lg font-semibold tracking-tight">Copy this booking</h2>
              <p className="text-sm text-ink-500">Pick the dates. Same venue, times, money and details; no payments or check-ins.</p>
            </div>
            {result?.confirm ? (
              // An act who hasn't signed up to Gigsaw yet: an admin can copy with them anyway (src/lib/book-signed-up.ts).
              <div className="space-y-4 p-5">
                <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950" role="alert">
                  <div className="font-semibold">{result.confirm.title}</div>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {result.confirm.items.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn" onClick={() => setResult(null)}>
                    Back
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={pending}
                    onClick={() => start(async () => setResult(await copyBooking(bookingId, [...picked], status, keepAct, true)))}
                  >
                    {pending ? "Copying…" : (result.confirm.button ?? "Book anyway")}
                  </button>
                </div>
              </div>
            ) : result ? (
              <div className="space-y-4 p-5">
                <p className={`rounded-xl px-4 py-3 text-sm ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>{result.message}</p>
                {result.ok && result.ids.length === 1 ? (
                  <div className="grid grid-cols-2 gap-2">
                    <button className="btn btn-primary" onClick={() => router.push(`/bookings/${result.ids[0]}`)}>
                      Open the new booking
                    </button>
                    <button className="btn" onClick={close}>
                      Stay here
                    </button>
                  </div>
                ) : (
                  <button className="btn w-full" onClick={close}>
                    Done
                  </button>
                )}
              </div>
            ) : (
              <div className="p-5">
                <div className="mb-3 flex items-center justify-between">
                  <button type="button" className="btn btn-sm" onClick={() => shift(-1)} aria-label="Previous month">
                    ←
                  </button>
                  <span className="text-sm font-semibold">{title}</span>
                  <button type="button" className="btn btn-sm" onClick={() => shift(1)} aria-label="Next month">
                    →
                  </button>
                </div>
                <div className="grid grid-cols-7 gap-1 text-center text-xs">
                  {WEEKDAYS.map((d) => (
                    <div key={d} className="py-1 text-ink-500">
                      {d}
                    </div>
                  ))}
                  {cells.map((d, i) => {
                    if (d === null) return <div key={`b${i}`} />;
                    const k = key(month.y, month.m, d);
                    const on = picked.has(k);
                    const past = k < today;
                    const original = k === startDate;
                    return (
                      <button
                        key={k}
                        type="button"
                        disabled={past}
                        onClick={() => toggle(k)}
                        aria-pressed={on}
                        className={`h-9 rounded-lg text-sm tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
                          on ? "bg-volt-400 font-semibold text-black" : original ? "ring-1 ring-ink-400" : "hover:bg-ink-100"
                        }`}
                        title={original ? "This booking's date" : undefined}
                      >
                        {d}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink-100 pt-4 text-sm">
                  <span>Every week for</span>
                  <input
                    type="number"
                    min={1}
                    max={MAX_COPY_DATES}
                    value={weeks}
                    onChange={(e) => setWeeks(e.target.value)}
                    aria-label="Number of weeks"
                    className="input w-20"
                  />
                  <span>weeks</span>
                  <button type="button" className="btn btn-sm" onClick={pickWeekly}>
                    Pick them
                  </button>
                  {picked.size > 0 && (
                    <button type="button" className="btn btn-sm ml-auto" onClick={() => setPicked(new Set())}>
                      Clear
                    </button>
                  )}
                </div>
                <p className={`mt-2 text-xs ${tooMany ? "font-medium text-rose-700" : "text-ink-500"}`} role="status">
                  {picked.size === 0
                    ? `Tap days on the calendar, or pick every week. Up to ${MAX_COPY_DATES} dates.`
                    : `${picked.size} date${picked.size === 1 ? "" : "s"} picked, the last on ${shortDate(last!)}.${tooMany ? ` That's more than ${MAX_COPY_DATES}: take some off.` : ""}`}
                </p>
                <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
                  <label className="block">
                    <span className="label">Status of the copies</span>
                    <select value={status} onChange={(e) => setStatus(e.target.value)} className="input">
                      <option value="PENDING">Pending</option>
                      <option value="AWAITING" disabled={!hasAct || !keepAct}>
                        Awaiting confirmation (offer to the act)
                      </option>
                      <option value="CONFIRMED" disabled={!hasAct || !keepAct}>
                        Confirmed
                      </option>
                    </select>
                  </label>
                  {hasAct && (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={keepAct}
                        onChange={(e) => (setKeepAct(e.target.checked), !e.target.checked && setStatus("PENDING"))}
                        className="h-4 w-4"
                      />
                      Keep the act ({actName})
                    </label>
                  )}
                  <div className="flex items-center gap-2">
                    <button type="button" className="btn" onClick={close}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!picked.size || tooMany || pending}
                      className="btn btn-primary ml-auto"
                      onClick={() => start(async () => setResult(await copyBooking(bookingId, [...picked], status, keepAct)))}
                    >
                      {pending ? "Copying…" : picked.size ? `Copy to ${picked.size} date${picked.size === 1 ? "" : "s"}` : "Pick dates"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </dialog>,
          document.body,
        )}
    </>
  );
}
