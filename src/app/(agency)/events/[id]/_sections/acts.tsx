import Link from "next/link";
import { addEventAct } from "@/actions/events";
import { ActionForm, SubmitButton } from "@/components/forms";
import { ArtistDot, StatusBadge } from "@/components/ui";
import { BOOKING_STATUS_LABELS, actName } from "@/lib/constants";
import { dealBreakdown, formatMoney } from "@/lib/money";
import { localTime } from "@/lib/time";
import type { EventPageData, EventView } from "../_data";

/** Each act's booking with its sale and cost, and the form to add another act. */
export function ActsSection({
  event: e,
  acts,
  currency,
  defaultCurrency,
}: {
  event: EventView;
  acts: EventPageData["acts"];
  currency: string;
  defaultCurrency: string;
}) {
  const m = (x: number) => formatMoney(x, currency);
  const lastBooking = e.bookings.at(-1);
  return (
    <section>
      <h2 className="mb-3 text-[17px] font-semibold tracking-tight">Acts</h2>
      <div className="card overflow-x-auto">
        {e.bookings.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Act</th>
                <th>Arrive</th>
                <th>On</th>
                <th>Status</th>
                <th className="text-right">Sale</th>
                <th className="text-right">Cost</th>
              </tr>
            </thead>
            <tbody>
              {e.bookings.map((b) => {
                const d = dealBreakdown(b);
                return (
                  <tr key={b.id} className={b.status === "CANCELLED" ? "opacity-50" : ""}>
                    <td>
                      <Link href={`/bookings/${b.id}`} className="flex items-center gap-2 font-medium hover:underline">
                        <ArtistDot colour={b.artist?.colour ?? "#a2a199"} />
                        {actName(b)}
                      </Link>
                      <div className="pl-[18px] text-xs text-ink-500">{b.reference}</div>
                    </td>
                    <td className="tabular-nums">{localTime(b.arriveBy, b.timezone)}</td>
                    <td className="tabular-nums">
                      {localTime(b.setStart, b.timezone)}
                      {b.setEnd ? `–${localTime(b.setEnd, b.timezone)}` : ""}
                    </td>
                    <td>
                      <StatusBadge status={b.status} />
                      {b.customerToldAt && <div className="mt-1 text-xs text-emerald-700">Customer told</div>}
                      {b.offerResponse === "DECLINED" && b.status === "AWAITING" && <div className="mt-1 text-xs font-medium text-rose-700">Act declined</div>}
                    </td>
                    <td className="text-right tabular-nums">{m(d.totalDueMinor)}</td>
                    <td className="text-right tabular-nums text-ink-600">{m(d.artistMinor)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <div className={`p-5 ${e.bookings.length ? "border-t border-ink-100" : ""}`}>
          <h3 className="mb-3 text-sm font-medium text-ink-800">Add an act</h3>
          <ActionForm action={addEventAct.bind(null, e.id)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="sm:col-span-2">
              <span className="label">Act</span>
              <select name="artistId" defaultValue="" className="input">
                <option value="">No act yet (add later)</option>
                {acts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Status</span>
              <select name="status" defaultValue="PENDING" className="input">
                {(["PENDING", "AWAITING", "CONFIRMED", "HOLD", "ENQUIRY"] as const).map((s) => (
                  <option key={s} value={s}>
                    {BOOKING_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">VAT %</span>
              <input name="vatPct" inputMode="decimal" defaultValue={lastBooking?.vatPct || ""} placeholder="0" className="input" />
            </label>
            <label>
              <span className="label">Arrive</span>
              <input name="arriveTime" type="time" className="input" />
            </label>
            <label>
              <span className="label">On</span>
              <input name="startTime" type="time" required className="input" />
            </label>
            <label>
              <span className="label">Finish</span>
              <input name="endTime" type="time" className="input" />
            </label>
            <div />
            <label>
              <span className="label">Sale ({defaultCurrency})</span>
              <input name="sale" inputMode="decimal" placeholder="What the customer pays" className="input" />
            </label>
            <label>
              <span className="label">Cost</span>
              <input name="cost" inputMode="decimal" placeholder="The act's fee" className="input" />
            </label>
            <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="notify" defaultChecked className="h-4 w-4" />
                Tell the act
              </label>
              <SubmitButton className="btn btn-primary ml-auto" pendingText="Adding…">
                Add act
              </SubmitButton>
            </div>
          </ActionForm>
          <p className="hint">Each act gets its own booking: they see their times, the plan below and their own fee (the cost). Never the sale.</p>
        </div>
      </div>
    </section>
  );
}
