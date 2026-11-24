import Link from "next/link";

export type AlsoChange = {
  venueId: string;
  venueName: string;
  weekdayName: string;
  all: number;
  weekday: number;
  slot: number;
  weekdaySlot: number;
  startTime: string;
};

/**
 * At the foot of a booking's edit form: copy this save's changes to the venue's other upcoming bookings
 * (actions/bookings.ts, lib/venue-change.ts). Saving with anything but "Only this booking" asks first.
 */
export function AlsoChangePanel({ venueId, venueName, weekdayName, all, weekday, slot, weekdaySlot, startTime }: AlsoChange) {
  // The same-time choices first: a venue with two sets a night (e.g. 5pm and 9pm) changes only the one it means.
  const options = [
    { value: "ONE", label: "Only this booking", count: null },
    { value: "WEEKDAY_SLOT", label: `Upcoming ${weekdayName}s starting at ${startTime}`, count: weekdaySlot },
    { value: "SLOT", label: `Every upcoming gig starting at ${startTime}`, count: slot },
    { value: "WEEKDAY", label: `All upcoming ${weekdayName}s, any time`, count: weekday },
    { value: "ALL", label: `All upcoming bookings at ${venueName}, any time`, count: all },
  ];
  return (
    <section className="card card-pad space-y-4" aria-labelledby="also-change-title">
      <div>
        <h2 id="also-change-title" className="section-title">
          Also change other bookings at {venueName}
        </h2>
        <p className="text-sm text-ink-500">
          Copies only what you changed here: times, itinerary, notes, sale and cost. Each booking keeps its own date, act and status. Past, cancelled, settled
          and archived bookings are left alone.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex items-start gap-3 rounded-xl border border-ink-200 p-3 has-[:checked]:border-ink-950 has-[:checked]:bg-ink-50 ${
              o.count === 0 ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-ink-300"
            }`}
          >
            <input
              type="radio"
              name="alsoChange"
              value={o.value}
              defaultChecked={o.value === "ONE"}
              disabled={o.count === 0}
              className="mt-0.5 h-4 w-4 accent-ink-950"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-ink-500">
                {o.count === null ? "Just the booking you're editing" : o.count === 0 ? "None coming up" : `${o.count} more booking${o.count === 1 ? "" : "s"}`}
              </span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-ink-500">
        To pick bookings one by one,{" "}
        <Link href={`/bookings?venue=${venueId}`} className="link">
          change several bookings at once
        </Link>{" "}
        from the list.
      </p>
    </section>
  );
}
