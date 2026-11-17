import { BOOKING_STATUS_LABELS, type BookingStatus } from "./constants";

// Which bookings the money figures count (dashboard venue numbers, Reports, venue statements and
// invoices). By default every booking that isn't cancelled, so a venue's bill at the start of the
// month includes gigs still waiting for an act or a yes. Narrowed with ?st=CONFIRMED&st=… .

export const COUNTABLE: BookingStatus[] = ["ENQUIRY", "HOLD", "PENDING", "AWAITING", "CONFIRMED", "SETTLED"];

/** The statuses picked in the URL, in a fixed order; none (or nothing valid) means all of them. */
export function readStatuses(raw: string | string[] | undefined): BookingStatus[] {
  const picked = new Set([raw ?? []].flat());
  const list = COUNTABLE.filter((s) => picked.has(s));
  return list.length ? list : [...COUNTABLE];
}

export const isAllStatuses = (list: readonly string[]) => list.length === COUNTABLE.length;

/** The ?st= pairs to keep the choice in a link: none when it's everything (the default). */
export function statusParams(list: readonly string[]): [string, string][] {
  return isAllStatuses(list) ? [] : list.map((s) => ["st", s]);
}

/** "All except cancelled", or the picked ones, e.g. "Confirmed, Settled". */
export function statusesLabel(list: readonly BookingStatus[]) {
  return isAllStatuses(list) ? "All except cancelled" : list.map((s) => BOOKING_STATUS_LABELS[s]).join(", ");
}
