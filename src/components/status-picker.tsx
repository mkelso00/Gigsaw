import { BOOKING_STATUS_LABELS, type BookingStatus } from "@/lib/constants";
import { COUNTABLE, statusesLabel } from "@/lib/count-statuses";

/**
 * A drop-down of booking statuses for the money figures: tick the ones to count and press Show.
 * It's a plain GET form, so `keep` carries the page's other choices (month, venue, dates).
 */
export function StatusPicker({ selected, keep = {}, action }: { selected: BookingStatus[]; keep?: Record<string, string>; action?: string }) {
  return (
    <details className="relative">
      <summary className="btn btn-sm cursor-pointer list-none">
        Counting: <span className="font-semibold">{statusesLabel(selected)}</span> ▾
      </summary>
      <form action={action} className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-ink-200 bg-white p-3 shadow-lg">
        {Object.entries(keep).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <p className="mb-2 text-xs text-ink-500">Which bookings to count. Cancelled ones never count.</p>
        <div className="space-y-1.5">
          {COUNTABLE.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="st" value={s} defaultChecked={selected.includes(s)} className="h-4 w-4" />
              {BOOKING_STATUS_LABELS[s]}
            </label>
          ))}
        </div>
        <button className="btn btn-primary btn-sm mt-3 w-full">Show</button>
      </form>
    </details>
  );
}
