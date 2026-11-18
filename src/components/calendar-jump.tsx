"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The calendar's title (e.g. "June 2029") as a button: it opens a small calendar to jump to any year, month or
 * day, keeping the view and filters (`base` is the page's query without the date).
 */
export function CalendarJump({ title, anchor, today, base }: { title: string; anchor: string; today: string; base: string }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(anchor.slice(0, 4)));
  const [month, setMonth] = useState(Number(anchor.slice(5, 7)) - 1);
  const box = useRef<HTMLDivElement>(null);

  // Opening again starts from the date on screen; a click outside or Escape closes it.
  useEffect(() => {
    if (!open) return;
    setYear(Number(anchor.slice(0, 4)));
    setMonth(Number(anchor.slice(5, 7)) - 1);
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open, anchor]);

  const href = (date: string) => `/calendar?${base ? `${base}&` : ""}date=${date}`;
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // weeks start on Monday
  const key = (d: number) => `${year}-${pad(month + 1)}-${pad(d)}`;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${title}: choose a date`}
        className="min-w-32 rounded-lg px-2 py-1 text-center text-sm font-medium hover:bg-ink-100"
      >
        {title} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a date" className="absolute right-0 z-30 mt-1 w-72 rounded-xl border border-ink-200 bg-white p-3 shadow-lg">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="btn btn-sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">
              ‹
            </button>
            <span className="text-sm font-semibold">{year}</span>
            <button type="button" className="btn btn-sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">
              ›
            </button>
          </div>
          <div className="mb-3 grid grid-cols-6 gap-1">
            {MONTHS.map((m, i) => (
              <button
                key={m}
                type="button"
                onClick={() => setMonth(i)}
                className={`rounded-md py-1 text-xs ${i === month ? "bg-ink-950 font-semibold text-white" : "hover:bg-ink-100"}`}
              >
                {m}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center text-[11px]">
            {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
              <span key={i} className="py-1 text-ink-400">
                {d}
              </span>
            ))}
            {Array.from({ length: lead }, (_, i) => (
              <span key={`x${i}`} />
            ))}
            {Array.from({ length: days }, (_, i) => i + 1).map((d) => (
              <Link
                key={d}
                href={href(key(d))}
                onClick={() => setOpen(false)}
                className={`rounded-md py-1 tabular-nums hover:bg-ink-100 ${key(d) === today ? "font-bold text-volt-700" : ""} ${key(d) === anchor ? "bg-ink-950 text-white hover:bg-ink-800" : ""}`}
              >
                {d}
              </Link>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-ink-100 pt-2">
            <Link href={href(`${year}-${pad(month + 1)}-01`)} onClick={() => setOpen(false)} className="btn btn-sm">
              Show {MONTHS[month]} {year}
            </Link>
            <Link href={href(today)} onClick={() => setOpen(false)} className="btn btn-sm">
              Today
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
