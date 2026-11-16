"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { confirmCalendarAdded } from "@/actions/act-calendar";
import { ServerForm, SubmitButton } from "@/components/forms";

/**
 * Wraps the add-to-calendar buttons. Once one is pressed, "I've added it" appears (for calendars that are slow
 * to fetch), and the page checks every few seconds whether the calendar has fetched the gigs, which moves the
 * act on by itself.
 */
export function AddCalendarStep({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pressed, setPressed] = useState(false);
  useEffect(() => {
    if (!pressed) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [pressed, router]);
  return (
    <div className="space-y-5">
      <div
        onClickCapture={(e) => {
          if ((e.target as Element).closest("a, button")) setPressed(true);
        }}
      >
        {children}
      </div>
      {pressed ? (
        <ServerForm action={confirmCalendarAdded} className="space-y-2 rounded-2xl border border-white/[0.06] bg-ink-900 p-5">
          <p className="text-sm text-ink-300">Added your gigs? This page moves on by itself once your calendar has them. If it doesn&apos;t after a minute:</p>
          <SubmitButton className="h-11 w-full rounded-xl bg-volt-400 text-[15px] font-medium text-ink-950 hover:bg-volt-300" pendingText="One moment…">
            I&apos;ve added it
          </SubmitButton>
        </ServerForm>
      ) : (
        <p className="text-center text-sm text-ink-500">Pick your calendar above to carry on.</p>
      )}
    </div>
  );
}
