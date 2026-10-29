"use client";

import { useRef, useState } from "react";

export type GigCard = {
  when: string;
  overnight: string | null;
  status: string;
  money: [string, string][];
  people: [string, string][];
};

/**
 * Wraps a gig on the calendar and shows a details card while the mouse is over it: when it is,
 * the money, and who's involved. The card is positioned against the window so the calendar's
 * scrolling area never cuts it off.
 */
export function GigHover({ card, children }: { card: GigCard; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = 340;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    // Below the gig if there's room, otherwise above it.
    const top = r.bottom + 260 < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - 266);
    setPos({ left, top });
  };
  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)}>
      {children}
      {pos && (
        <div
          role="tooltip"
          className="pointer-events-none fixed z-50 w-[340px] rounded-xl border border-ink-200 bg-white p-4 text-xs shadow-2xl shadow-black/30"
          style={{ left: pos.left, top: pos.top }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold text-ink-950 tabular-nums">{card.when}</div>
            <span className="badge shrink-0 bg-ink-100 text-ink-700">{card.status}</span>
          </div>
          {card.overnight && <div className="mt-1 text-ink-500">☾ {card.overnight}</div>}
          {card.money.length > 0 && (
            <dl className="mt-3 space-y-1 border-t border-ink-100 pt-3">
              {card.money.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3">
                  <dt className="text-ink-500">{k}</dt>
                  <dd className="font-medium text-ink-950 tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <dl className="mt-3 space-y-1.5 border-t border-ink-100 pt-3">
            {card.people.map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <dt className="w-24 shrink-0 text-ink-500">{k}</dt>
                <dd className="min-w-0 text-ink-950">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
