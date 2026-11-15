"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Something already on file, shown masked (e.g. ••••5678) with a Change button. The fields to
 * change it are only put in the form once Change is pressed, so the full number never has to be
 * sent to the page, and a form saved without pressing Change keeps what's on file.
 */
export function Reveal({
  summary,
  children,
  dark = false,
  label = "Change",
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  dark?: boolean;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.querySelector<HTMLInputElement>("input, textarea")?.focus();
  }, [open]);
  if (open) return <div ref={box}>{children}</div>;
  return (
    <div
      className={`flex min-h-11 items-center justify-between gap-3 rounded-xl border px-3.5 py-2 ${
        dark ? "border-white/10 bg-white/[0.04] text-white" : "border-ink-200 bg-ink-50 text-ink-950"
      }`}
    >
      <div className="min-w-0 tabular-nums">{summary}</div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`shrink-0 text-sm font-medium underline-offset-4 hover:underline ${dark ? "text-volt-400" : "text-ink-700"}`}
      >
        {label}
      </button>
    </div>
  );
}
