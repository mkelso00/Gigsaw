"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Hit = { kind: "act" | "person" | "venue" | "contact" | "booking" | "event" | "page"; href: string; title: string; sub: string; colour?: string };

const KIND: Record<Hit["kind"], string> = {
  booking: "Booking",
  act: "Act",
  person: "Person",
  event: "Wedding/event",
  venue: "Venue",
  contact: "Contact",
  page: "Page",
};

/**
 * The search box at the top of every agency page. Results appear as you type, from acts,
 * venues, contacts, bookings (any date) and pages. Press "/" anywhere to jump to it; arrow
 * keys and Enter to pick; Enter with nothing picked opens the full results page.
 */
export function QuickSearch() {
  const router = useRouter();
  const params = useSearchParams();
  const ref = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState(params.get("q") ?? "");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        ref.current?.focus();
        ref.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        if (res.ok) {
          setHits(((await res.json()) as { hits: Hit[] }).hits);
          setActive(-1);
        }
      } catch {
        // aborted by the next keystroke
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const go = (href: string) => {
    setOpen(false);
    ref.current?.blur();
    router.push(href);
  };
  const all = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : null;
  const show = open && !!q.trim();

  return (
    <form
      role="search"
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        if (active >= 0 && hits[active]) go(hits[active].href);
        else if (all) go(all);
      }}
    >
      <svg
        viewBox="0 0 24 24"
        className="pointer-events-none absolute top-[22px] left-3.5 h-4 w-4 -translate-y-1/2 text-ink-400"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        aria-hidden
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        ref={ref}
        name="q"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.min(i + 1, hits.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, -1));
          } else if (e.key === "Escape") {
            setOpen(false);
            ref.current?.blur();
          }
        }}
        autoComplete="off"
        placeholder="Search acts, venues, towns, contacts, bookings…"
        aria-label="Search everything"
        aria-expanded={show}
        aria-controls="search-results"
        role="combobox"
        className="h-11 w-full rounded-xl border border-ink-200 bg-white pr-12 pl-10 text-[15px] placeholder:text-ink-400 focus:border-ink-950 focus:ring-4 focus:ring-volt-300/60 focus:outline-none"
      />
      <kbd className="pointer-events-none absolute top-[22px] right-3 hidden -translate-y-1/2 rounded border border-ink-200 px-1.5 text-xs text-ink-400 sm:block">
        /
      </kbd>
      {show && (
        <div
          id="search-results"
          role="listbox"
          className="absolute top-full right-0 left-0 z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-ink-200 bg-white p-1.5 shadow-xl shadow-ink-950/10"
        >
          {hits.length === 0 ? (
            <div className="px-3 py-3 text-sm text-ink-500">{loading ? "Searching…" : `Nothing found for “${q.trim()}”.`}</div>
          ) : (
            hits.map((h, i) => (
              <button
                key={`${h.kind}-${h.href}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => go(h.href)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${i === active ? "bg-ink-100" : ""}`}
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: h.colour ?? "var(--color-ink-300)" }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-950">{h.title}</span>
                  <span className="block truncate text-xs text-ink-500">{h.sub}</span>
                </span>
                <span className="shrink-0 rounded bg-ink-50 px-1.5 py-0.5 text-[11px] text-ink-500">{KIND[h.kind]}</span>
              </button>
            ))
          )}
          {all && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(all)}
              className="mt-1 w-full rounded-lg border-t border-ink-100 px-3 py-2.5 text-left text-sm text-ink-600 hover:bg-ink-50"
            >
              See all gigs for &ldquo;{q.trim()}&rdquo; →
            </button>
          )}
        </div>
      )}
    </form>
  );
}
