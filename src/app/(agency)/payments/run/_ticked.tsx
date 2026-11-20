"use client";

import { useEffect, useRef, useState } from "react";

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
