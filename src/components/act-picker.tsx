"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { filterOptions } from "@/components/combobox";

export type PickableAct = {
  id: string;
  name: string;
  /** e.g. "Solo · York", to tell acts apart. */
  detail?: string;
  /** Why they may not be free that day, e.g. "Away: Holiday" or "Has a gig". */
  hint?: string;
  /** "away" (blocked the day out) or "busy" (already booked). */
  tone?: "away" | "busy";
};

/**
 * Tick several acts, with a search box to narrow a long roster. Ticked acts are sent as
 * `actId` even while the search hides them. Acts who may not be free say why, but can still be
 * ticked.
 */
export function ActPicker({ acts, defaultIds = [] }: { acts: PickableAct[]; defaultIds?: string[] }) {
  const [q, setQ] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(defaultIds));
  // After a successful save the form clears: start again with nothing searched or ticked.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      setQ("");
      setTicked(new Set(defaultIds));
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultIds]);
  const shown = useMemo(() => new Set(filterOptions(acts, q).map((a) => a.id)), [acts, q]);
  const shownFree = acts.filter((a) => shown.has(a.id) && !a.tone);
  const toggle = (id: string, on: boolean) =>
    setTicked((t) => {
      const next = new Set(t);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  return (
    <div ref={box} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search acts, type or town"
          aria-label="Search acts"
          className="input min-w-0 flex-1 basis-full sm:basis-auto"
          // Enter in the search box mustn't send the form.
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
        <button type="button" className="btn btn-sm" onClick={() => setTicked((t) => new Set([...t, ...shownFree.map((a) => a.id)]))}>
          Tick all free{q ? " shown" : ""}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setTicked(new Set())} disabled={!ticked.size}>
          Clear
        </button>
      </div>
      <p className="text-xs text-ink-500" aria-live="polite">
        {ticked.size ? `${ticked.size} act${ticked.size === 1 ? "" : "s"} ticked` : "No acts ticked yet"}
      </p>
      <ul className="max-h-[22rem] divide-y divide-ink-100 overflow-y-auto overscroll-contain rounded-xl border border-ink-200 bg-white">
        {acts.map((a) => (
          <li key={a.id} className={shown.has(a.id) ? "" : "hidden"}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm hover:bg-ink-50">
              <input
                type="checkbox"
                name="actId"
                value={a.id}
                checked={ticked.has(a.id)}
                onChange={(e) => toggle(a.id, e.target.checked)}
                className="h-4 w-4"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{a.name}</span>
                {a.detail && <span className="block truncate text-xs text-ink-500">{a.detail}</span>}
              </span>
              {a.hint && (
                <span
                  className={`badge max-w-[45%] shrink truncate ${a.tone === "away" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}`}
                  title={a.hint}
                >
                  {a.hint}
                </span>
              )}
            </label>
          </li>
        ))}
        {!shown.size && <li className="px-3 py-3 text-sm text-ink-500">No acts match &ldquo;{q}&rdquo;</li>}
      </ul>
    </div>
  );
}
