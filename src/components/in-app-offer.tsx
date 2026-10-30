"use client";

import { useTransition } from "react";
import { answerInApp } from "@/actions/offers";

/** Accept / Decline for an offer shown in the artist app. */
export function InAppOffer({ bookingId }: { bookingId: string }) {
  const [pending, start] = useTransition();
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <button
        disabled={pending}
        onClick={() => start(() => answerInApp(bookingId, "ACCEPTED"))}
        className="h-11 rounded-xl bg-volt-400 text-[15px] font-medium text-ink-950 hover:bg-volt-300 disabled:opacity-50"
      >
        Accept
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (window.confirm("Decline this booking?")) start(() => answerInApp(bookingId, "DECLINED"));
        }}
        className="h-11 rounded-xl border border-white/10 bg-white/[0.06] text-[15px] font-medium text-white hover:bg-white/[0.1] disabled:opacity-50"
      >
        Decline
      </button>
    </div>
  );
}
