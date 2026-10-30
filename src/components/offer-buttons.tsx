"use client";

import { useState, useTransition } from "react";
import { acceptAllByToken, answerByToken } from "@/actions/offers";

/** Accept / Decline on the offer page (no login). */
export function OfferButtons({ token, all }: { token: string; all?: number }) {
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  if (result)
    return (
      <p className={`rounded-xl px-4 py-3 text-sm font-medium ${result.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
        {result.message}
      </p>
    );
  return (
    <div className="flex flex-wrap gap-2">
      <button disabled={pending} onClick={() => start(async () => setResult(await answerByToken(token, "ACCEPTED")))} className="btn btn-primary flex-1">
        Accept
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (window.confirm("Decline this booking?")) start(async () => setResult(await answerByToken(token, "DECLINED")));
        }}
        className="btn flex-1"
      >
        Decline
      </button>
      {all && all > 1 ? (
        <button disabled={pending} onClick={() => start(async () => setResult(await acceptAllByToken(token)))} className="btn btn-volt w-full">
          Accept all {all} offers
        </button>
      ) : null}
    </div>
  );
}
