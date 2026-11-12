"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { answerInApp } from "@/actions/offers";
import { refreshAndWatch } from "@/components/render-stamp";

/**
 * Accept / Decline for an offer shown in the artist app. Runs outside a React transition with its own busy
 * flag, then refreshes with a reload fallback: in a transition Next 15.5 sometimes never showed the answer.
 */
export function InAppOffer({ bookingId }: { bookingId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const answer = async (a: "ACCEPTED" | "DECLINED") => {
    setPending(true);
    try {
      await answerInApp(bookingId, a);
      refreshAndWatch(router);
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="mt-4 grid grid-cols-2 gap-2">
      <button
        disabled={pending}
        onClick={() => void answer("ACCEPTED")}
        className="h-11 rounded-xl bg-volt-400 text-[15px] font-medium text-ink-950 hover:bg-volt-300 disabled:opacity-50"
      >
        Accept
      </button>
      <button
        disabled={pending}
        onClick={() => {
          if (window.confirm("Decline this booking?")) void answer("DECLINED");
        }}
        className="h-11 rounded-xl border border-white/10 bg-white/[0.06] text-[15px] font-medium text-white hover:bg-white/[0.1] disabled:opacity-50"
      >
        Decline
      </button>
    </div>
  );
}
