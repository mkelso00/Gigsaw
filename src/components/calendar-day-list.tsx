"use client";

import Link from "next/link";
import { useRef, type CSSProperties } from "react";

export type DayListGig = {
  id: string;
  time: string;
  act: string;
  venue: string;
  status: string;
  className: string;
  style?: CSSProperties;
};

/**
 * "All 17 gigs" on a busy day in the month view: every gig that day in time order, in a panel over the
 * calendar, so a packed day can be read without leaving the month.
 */
export function BusyDayList({ label, gigs, addHref }: { label: string; gigs: DayListGig[]; addHref: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.showModal()}
        className="pointer-events-auto block w-full rounded px-1.5 py-0.5 text-left text-[11px] font-medium text-ink-700 hover:bg-ink-100 hover:underline"
      >
        All {gigs.length} gigs →
      </button>
      <dialog
        ref={ref}
        onClick={(e) => {
          if (e.target === ref.current) ref.current?.close();
        }}
        className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 text-ink-950 shadow-2xl backdrop:bg-ink-950/40"
      >
        <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{label}</h2>
            <p className="text-sm text-ink-500">{gigs.length} gigs</p>
          </div>
          <button type="button" onClick={() => ref.current?.close()} className="rounded-lg px-2 py-1 text-ink-500 hover:bg-ink-100" aria-label="Close">
            ✕
          </button>
        </div>
        <ul className="max-h-[70vh] space-y-1.5 overflow-y-auto p-3">
          {gigs.map((g) => (
            <li key={g.id}>
              <Link
                href={`/bookings/${g.id}`}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:brightness-95 ${g.className}`}
                style={g.style}
              >
                <span className="w-12 shrink-0 font-medium tabular-nums">{g.time}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{g.venue}</span>
                  <span className="block truncate text-xs opacity-80">{g.act}</span>
                </span>
                <span className="shrink-0 text-xs opacity-80">{g.status}</span>
              </Link>
            </li>
          ))}
        </ul>
        <div className="border-t border-ink-100 px-5 py-3 text-right">
          <Link href={addHref} className="text-sm font-medium text-ink-700 hover:underline">
            Open this day →
          </Link>
        </div>
      </dialog>
    </>
  );
}
