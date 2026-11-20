"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Played", ticked to start with. Unticking it (a no-show, say) asks for a short reason, which goes on the
 * booking, and leaves the gig out: no invoice is made for it.
 */
export function PlayedTick({ id, label }: { id: string; label: string }) {
  const [played, setPlayed] = useState(true);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-sm font-medium">
        <input
          type="checkbox"
          name="played"
          value={id}
          defaultChecked
          onChange={(e) => setPlayed(e.currentTarget.checked)}
          aria-label={`Played: ${label}`}
          className="h-4 w-4 accent-ink-950"
        />
        Played
      </label>
      {!played && (
        <input
          name={`reason_${id}`}
          required
          maxLength={200}
          placeholder="Why not? e.g. didn't turn up"
          aria-label={`Why ${label} is left out`}
          className="input h-8 w-56 max-w-full py-1 text-sm"
        />
      )}
    </span>
  );
}

/** "3 ticked": how many of the form's `name` boxes are ticked, kept up to date as they change. */
export function TickedCount({ name }: { name: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const count = () => setN(form.querySelectorAll(`input[type=checkbox][name="${name}"]:checked`).length);
    // A successful save resets the form, which fires no change event.
    const later = () => setTimeout(count, 0);
    count();
    form.addEventListener("change", count);
    form.addEventListener("reset", later);
    return () => {
      form.removeEventListener("change", count);
      form.removeEventListener("reset", later);
    };
  }, [name]);
  return (
    <span ref={ref} className="text-ink-500 tabular-nums" aria-live="polite">
      {n ? `${n} ticked` : ""}
    </span>
  );
}
