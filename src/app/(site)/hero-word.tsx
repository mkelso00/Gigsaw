"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const WORDS = ["booked", "confirmed", "checked in", "paid"];

/**
 * The changing word in the home page headline, in a pill with a channel light. The pill eases to
 * the width of each word (measured from hidden copies) while the words fade and slide through.
 */
export function HeroWord() {
  const [i, setI] = useState(0);
  const [width, setWidth] = useState<number | null>(null);
  const sizer = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % WORDS.length), 2400);
    return () => clearInterval(t);
  }, []);

  useLayoutEffect(() => {
    const measure = () => setWidth((sizer.current?.children[i] as HTMLElement | undefined)?.offsetWidth ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [i]);

  return (
    <span className="relative inline-flex items-center gap-[0.18em] rounded-full bg-volt-100 px-[0.32em] align-baseline text-volt-700 ring-1 ring-volt-200">
      <span className="h-[0.2em] w-[0.2em] shrink-0 rounded-full bg-volt-500 shadow-[0_0_0.25em_var(--color-volt-400)]" aria-hidden />
      <span className="relative inline-block overflow-hidden transition-[width] duration-500 ease-out" style={{ width: width ?? undefined }}>
        {/* Invisible copies, only there to be measured. */}
        <span ref={sizer} aria-hidden className="invisible absolute top-0 left-0 flex">
          {WORDS.map((w) => (
            <span key={w} className="absolute whitespace-nowrap">
              {w}
            </span>
          ))}
        </span>
        <span className="inline-grid">
          {WORDS.map((w, n) => (
            <span
              key={w}
              aria-hidden={n !== i}
              className={`col-start-1 row-start-1 whitespace-nowrap transition-all duration-500 ${n === i ? "translate-y-0 opacity-100" : "translate-y-[0.35em] opacity-0"}`}
            >
              {w}
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}
