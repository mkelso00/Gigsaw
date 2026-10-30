"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";

/**
 * A page's buttons. On a computer they sit in a row beside the title; on a phone they fold
 * behind a "⋯" button so the top of the page stays tidy.
 */
export function HeaderActions({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative sm:static">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn h-10 w-10 justify-center p-0 sm:hidden"
        aria-label="More actions"
        aria-expanded={open}
      >
        <Icon name="more" className="h-5 w-5" />
      </button>
      <div
        // Tapping a link or button inside closes the menu (a form button still submits first).
        onClick={(e) => (e.target as HTMLElement).closest("a,button") && setTimeout(() => setOpen(false), 0)}
        className={`${open ? "flex" : "hidden"} absolute top-full right-0 z-30 mt-2 w-64 flex-col items-stretch gap-2 rounded-xl border border-ink-200 bg-white p-2 shadow-xl sm:static sm:mt-0 sm:flex sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:border-0 sm:bg-transparent sm:p-0 sm:shadow-none [&_.btn]:justify-center`}
      >
        {children}
      </div>
    </div>
  );
}

/** Phones: search and new booking as icons in the top bar. They open the same search and form as on a computer. */
export function MobileTopIcons() {
  return (
    <span className="flex items-center gap-1 lg:hidden">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("gigsaw:search"))}
        className="rounded-lg p-2 text-white hover:bg-white/[0.06]"
        aria-label="Search"
      >
        <Icon name="search" className="h-5 w-5" />
      </button>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("gigsaw:new-booking"))}
        className="rounded-lg p-2 text-volt-400 hover:bg-white/[0.06]"
        aria-label="New booking"
      >
        <Icon name="plus" className="h-5 w-5" />
      </button>
    </span>
  );
}

/** The search box row: always shown on a computer; on a phone only after tapping the search icon. */
export function SearchSlot({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const show = () => {
      setOpen(true);
      // Focus straight away (iOS only opens the keyboard from the tap itself), and again once shown.
      box.current?.querySelector("input")?.focus();
      requestAnimationFrame(() => box.current?.querySelector("input")?.focus());
    };
    window.addEventListener("gigsaw:search", show);
    return () => window.removeEventListener("gigsaw:search", show);
  }, []);
  return (
    <div
      ref={box}
      className={`${open ? "mb-5 flex" : "hidden"} max-w-xl min-w-0 flex-1 items-center gap-2 lg:mb-0 lg:flex`}
      onBlur={(e) =>
        !e.currentTarget.contains(e.relatedTarget as Node) && !(e.currentTarget.querySelector("input") as HTMLInputElement)?.value && setOpen(false)
      }
    >
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A page's filter box. Always shown on a computer; on a phone it folds behind a "Filters"
 * button (with how many are in use) so the list comes first.
 */
export function FilterPanel({ active = 0, always = false, children }: { active?: number; always?: boolean; children: React.ReactNode }) {
  // always: folded behind the button on computers too (and open while any filter is set), for calm busy pages.
  const [open, setOpen] = useState(always && active > 0);
  return (
    <div className="mb-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className={`btn btn-sm mb-2 ${always ? "" : "sm:hidden"}`} aria-expanded={open}>
        <Icon name="filter" className="h-4 w-4" />
        {open ? "Hide filters" : "Filters"}
        {active > 0 && <span className="rounded-full bg-volt-400 px-1.5 text-[11px] font-semibold text-ink-950">{active}</span>}
      </button>
      <div className={`${open ? "motion-page-in block" : "hidden"} ${always ? "" : "sm:block"} [&>form]:mb-0`}>{children}</div>
    </div>
  );
}

/** A button that drops down a short list of links, e.g. the printable documents for a booking. */
export function DropMenu({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="btn w-full" aria-expanded={open}>
        {label}
        <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform ${open ? "-rotate-90" : "rotate-90"}`} />
      </button>
      {open && (
        <div
          onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}
          className="motion-page-in absolute top-full right-0 z-40 mt-2 flex max-h-80 w-52 flex-col overflow-y-auto rounded-xl border border-ink-200 bg-white p-1.5 shadow-xl [&>a]:rounded-lg [&>a]:px-3 [&>a]:py-2 [&>a]:text-sm [&>a:hover]:bg-ink-50"
        >
          {children}
        </div>
      )}
    </div>
  );
}
