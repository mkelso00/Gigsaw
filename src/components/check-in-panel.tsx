"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { artistCheckIn, type CheckInPayload } from "@/actions/checkin";
import type { CheckInKind } from "@/lib/constants";

type Position = { latitude: number; longitude: number; accuracyM: number } | null;

function getPosition(): Promise<{ pos: Position; problem?: string }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return resolve({ pos: null, problem: "This phone can't share its location." });
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ pos: { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyM: p.coords.accuracy } }),
      (err) =>
        resolve({
          pos: null,
          problem:
            err.code === err.PERMISSION_DENIED ? "Location is turned off for Gigsaw, so it wasn't shared." : "Couldn't get your location, so it wasn't shared.",
        }),
      // Always take a fresh reading: a cached one from earlier in the journey would make
      // an arrival look like it happened away from the venue.
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });
}

const ETAS = [15, 30, 45, 60, 90, 120, 180];

export function CheckInPanel({
  bookingId,
  hasArrived,
  hasDeparted,
  windowOpen,
  windowMessage,
}: {
  bookingId: string;
  hasArrived: boolean;
  hasDeparted: boolean;
  windowOpen: boolean;
  windowMessage?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<CheckInKind | null>(null);
  const [eta, setEta] = useState(30);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = (kind: CheckInKind) => {
    setBusy(kind);
    setResult(null);
    startTransition(async () => {
      const { pos, problem } = await getPosition();
      const payload: CheckInPayload = { kind, ...(pos ?? {}), etaMinutes: kind === "ON_THE_WAY" ? eta : null };
      const res = await artistCheckIn(bookingId, payload);
      setResult({ ok: res.ok, text: res.ok && problem ? `${res.message} ${problem}` : res.message });
      setBusy(null);
      if (res.ok) router.refresh();
    });
  };

  if (!windowOpen) {
    return <p className="rounded-xl bg-white/[0.04] p-4 text-center text-sm text-ink-400">{windowMessage}</p>;
  }

  const disabled = pending || busy !== null;
  return (
    <div className="space-y-3">
      {!hasArrived && (
        <>
          <button
            type="button"
            onClick={() => send("ARRIVED")}
            disabled={disabled}
            className="w-full rounded-2xl bg-volt-400 px-6 py-5 text-xl font-semibold tracking-tight text-ink-950 shadow-[0_10px_40px_-10px_rgb(205_247_46/0.6)] transition hover:bg-volt-300 active:scale-[0.98] disabled:opacity-60"
          >
            {busy === "ARRIVED" ? "Checking you in…" : "I've arrived"}
          </button>
          <div className="flex gap-2">
            <select
              aria-label="How long until you arrive"
              value={eta}
              onChange={(e) => setEta(Number(e.target.value))}
              className="h-12 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-white focus:ring-2 focus:ring-volt-400 focus:outline-none"
              disabled={disabled}
            >
              {ETAS.map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min away` : `${m / 60} h away`}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => send("ON_THE_WAY")}
              disabled={disabled}
              className="h-12 flex-1 rounded-xl border border-white/10 bg-white/[0.06] text-[15px] font-medium text-white transition hover:bg-white/[0.1] disabled:opacity-60"
            >
              {busy === "ON_THE_WAY" ? "Sending…" : "I'm on the way"}
            </button>
          </div>
        </>
      )}
      {hasArrived && !hasDeparted && (
        <button
          type="button"
          onClick={() => send("DEPARTED")}
          disabled={disabled}
          className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.06] text-[15px] font-medium text-white transition hover:bg-white/[0.1] disabled:opacity-60"
        >
          {busy === "DEPARTED" ? "Sending…" : "I've left the venue"}
        </button>
      )}
      {hasArrived && hasDeparted && <p className="text-center text-sm text-ink-400">All done for this booking. Thanks!</p>}
      {result && (
        <p role="status" className={`rounded-xl px-3 py-2.5 text-sm ${result.ok ? "bg-volt-400/10 text-volt-300" : "bg-rose-500/15 text-rose-300"}`}>
          {result.text}
        </p>
      )}
      <p className="text-center text-xs text-ink-500">Your location is only used to confirm you&apos;re at the venue.</p>
    </div>
  );
}
