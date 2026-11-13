"use client";

/**
 * Fills a day square on the month calendar: clicking anywhere in it that isn't a booking opens the quick
 * New booking panel with that date filled in (QuickBooking listens for "gigsaw:new-booking").
 */
export function AddOnDay({ date, label }: { date: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={`Add a booking on ${label}`}
      title={`Add a booking on ${label}`}
      onClick={() => window.dispatchEvent(new CustomEvent("gigsaw:new-booking", { detail: { date } }))}
      className="group/add absolute inset-0 z-0 cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-volt-500"
    >
      <span
        aria-hidden
        className="absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-ink-950 text-sm leading-none text-white opacity-0 transition-opacity group-hover/add:opacity-100 group-focus-visible/add:opacity-100"
      >
        +
      </span>
    </button>
  );
}
