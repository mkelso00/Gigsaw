"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary no-print" onClick={() => window.print()}>
      Print or save as PDF
    </button>
  );
}

/** Re-fetches server data on an interval so live boards stay current. */
export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [last, setLast] = useState<Date | null>(null);
  useEffect(() => {
    setLast(new Date());
    const id = setInterval(() => {
      router.refresh();
      setLast(new Date());
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return (
    <span className="text-xs text-slate-500">
      Live, refreshes every {seconds}s{last ? ` · last ${last.toLocaleTimeString("en-GB")}` : ""}
    </span>
  );
}

/** Fills the latitude / longitude inputs with the device's current position. */
export function UseMyLocation() {
  const [msg, setMsg] = useState("");
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="btn btn-sm"
        onClick={() => {
          if (!navigator.geolocation) return setMsg("This device cannot share its location.");
          setMsg("Finding you…");
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              const lat = document.querySelector<HTMLInputElement>('input[name="latitude"]');
              const lng = document.querySelector<HTMLInputElement>('input[name="longitude"]');
              if (lat) lat.value = pos.coords.latitude.toFixed(6);
              if (lng) lng.value = pos.coords.longitude.toFixed(6);
              setMsg(`Set to your location (accurate to about ${Math.round(pos.coords.accuracy)} m).`);
            },
            (err) => setMsg(err.message || "Could not get your location."),
            { enableHighAccuracy: true, timeout: 15000 },
          );
        }}
      >
        Use my current location
      </button>
      {msg && <span className="text-xs text-slate-500">{msg}</span>}
    </div>
  );
}

export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly className="input font-mono text-xs" value={value} onFocus={(e) => e.currentTarget.select()} />
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** A few lines of code to copy, e.g. the enquiry form's embed code. */
export function CopyBlock({ value, label = "Copy code" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <textarea
        readOnly
        value={value}
        rows={value.split("\n").length}
        spellCheck={false}
        onFocus={(e) => e.currentTarget.select()}
        className="input resize-none font-mono text-xs leading-relaxed whitespace-pre"
      />
      <button
        type="button"
        className="btn btn-sm"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : label}
      </button>
    </div>
  );
}

/** A checkbox that ticks or unticks every checkbox with the given name in the same form. */
export function SelectAll({ name }: { name: string }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all"
      className="h-4 w-4 accent-ink-950"
      onChange={(e) => {
        const form = e.currentTarget.form;
        form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((c) => (c.checked = e.currentTarget.checked));
      }}
    />
  );
}

/**
 * A button that acts on the ticked rows of a list (archive, restore, delete). Asks first, says how
 * many, and does nothing if none are ticked.
 */
export function SelectedAction({
  name,
  action,
  label,
  confirm,
  danger = false,
}: {
  name: string;
  action: (form: FormData) => Promise<void>;
  label: string;
  /** The question to ask, with {n} for how many and {s} for the plural "s". */
  confirm: string;
  danger?: boolean;
}) {
  return (
    <button
      formAction={action}
      formMethod="post"
      className={`btn btn-sm ${danger ? "btn-danger" : ""}`}
      onClick={(e) => {
        const n = e.currentTarget.form?.querySelectorAll(`input[type=checkbox][name="${name}"]:checked`).length ?? 0;
        if (!n) {
          e.preventDefault();
          window.alert("Tick the bookings first.");
          return;
        }
        if (!window.confirm(confirm.replace("{n}", String(n)).replace("{s}", n === 1 ? "" : "s"))) e.preventDefault();
      }}
    >
      {label}
    </button>
  );
}
