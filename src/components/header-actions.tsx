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
