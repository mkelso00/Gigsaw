"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
import { copyBooking, type CopyResult } from "@/actions/bookings";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const key = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/**
 * "Copy" on a booking: pick any number of dates on a mini calendar and the booking is copied to
 * each. With one date you can jump to the new booking; with several you stay where you are.
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

  return (
    <>
      <button type="button" className="btn" onClick={() => ref.current?.showModal()}>
        Copy
      </button>
      <dialog
        ref={ref}
        className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-2xl border border-ink-200 bg-white p-0 shadow-2xl backdrop:bg-black/60"
        onClick={(e) => e.target === ref.current && close()}
      >
        <div className="border-b border-ink-100 px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">Copy this booking</h2>
          <p className="text-sm text-ink-500">Pick the dates. Same venue, times, money and details; no payments or check-ins.</p>
        </div>
        {result ? (
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
                  disabled={!picked.size || pending}
                  className="btn btn-primary ml-auto"
                  onClick={() => start(async () => setResult(await copyBooking(bookingId, [...picked], status, keepAct)))}
                >
                  {pending ? "Copying…" : picked.size ? `Copy to ${picked.size} date${picked.size === 1 ? "" : "s"}` : "Pick dates"}
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
