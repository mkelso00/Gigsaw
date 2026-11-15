"use client";

import { useState } from "react";

/** A value shown as text with a small Copy button, e.g. a sort code to paste into online banking. */
export function CopyValue({ value, shown, label }: { value: string; shown?: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono tabular-nums">{shown ?? value}</span>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        className="rounded-md border border-ink-200 px-1.5 py-0.5 text-[11px] font-medium text-ink-600 hover:bg-ink-100"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
