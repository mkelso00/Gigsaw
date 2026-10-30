// Allowed values for the string "enum" columns in the database, with display labels.

// The life of a gig: Pending (being set up, maybe no act yet) → Awaiting confirmation (offered to
// the act) → Confirmed (the act accepted: the gig is on) → Settled. Enquiry, On hold and Cancelled
// sit alongside. "Confirmed" is about the act; a wedding customer's side is tracked on the event.
export const BOOKING_STATUSES = ["ENQUIRY", "PENDING", "AWAITING", "HOLD", "CONFIRMED", "SETTLED", "CANCELLED"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  ENQUIRY: "Enquiry",
  PENDING: "Pending",
  AWAITING: "Awaiting confirmation",
  HOLD: "On hold",
  CONFIRMED: "Confirmed",
  SETTLED: "Settled",
  CANCELLED: "Cancelled",
};

// Tailwind classes for status badges: a soft fill, plus the colour of the leading dot.
export const BOOKING_STATUS_STYLES: Record<BookingStatus, string> = {
  ENQUIRY: "bg-ink-100 text-ink-700 [--dot:var(--color-ink-400)]",
  PENDING: "bg-ink-100 text-ink-800 [--dot:var(--color-sky-500)]",
  AWAITING: "bg-sky-50 text-sky-800 [--dot:var(--color-sky-500)]",
  HOLD: "bg-amber-50 text-amber-800 [--dot:var(--color-amber-500)]",
  CONFIRMED: "bg-emerald-50 text-emerald-800 [--dot:var(--color-emerald-500)]",
  SETTLED: "bg-ink-950 text-white [--dot:var(--color-volt-400)]",
  CANCELLED: "bg-ink-100 text-ink-500 line-through [--dot:var(--color-ink-300)]",
};

/** Statuses that need an act on the gig. */
export const NEEDS_ACT: BookingStatus[] = ["AWAITING", "HOLD", "CONFIRMED", "SETTLED"];
/** Statuses the act sees in their app and calendar (Pending and Enquiry are still being set up). */
export const ACT_VISIBLE: BookingStatus[] = ["AWAITING", "HOLD", "CONFIRMED", "SETTLED", "CANCELLED"];
/** The gig is on: reminders go out and the act is expected. */
export const ON_STATUSES: BookingStatus[] = ["CONFIRMED", "SETTLED"];

export const DEAL_TYPES = ["STANDARD_COMMISSION", "BUY_SELL", "VERSUS", "PLUS", "FLAT"] as const;
export type DealType = (typeof DEAL_TYPES)[number];

export const DEAL_TYPE_LABELS: Record<DealType, string> = {
  STANDARD_COMMISSION: "Standard commission",
  BUY_SELL: "Sale and cost",
  VERSUS: "Guarantee vs % of door",
  PLUS: "Guarantee plus bonus",
  FLAT: "Flat fee (no commission)",
};

export const EVENT_TYPES = ["GIG", "FESTIVAL", "CLUB_NIGHT", "WEDDING", "CORPORATE", "PRIVATE_PARTY", "OTHER"] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  GIG: "Bar gig",
  FESTIVAL: "Festival",
  CLUB_NIGHT: "Club night",
  WEDDING: "Wedding",
  CORPORATE: "Corporate event",
  PRIVATE_PARTY: "Private party",
  OTHER: "Other",
};

export function eventTypeLabel(t: string) {
  return EVENT_TYPE_LABELS[t as EventType] ?? t;
}

export const CONTACT_TYPES = ["PROMOTER", "CLIENT", "COMPANY", "VENUE_CONTACT", "COLLABORATOR", "OTHER"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const CONTACT_TYPE_LABELS: Record<ContactType, string> = {
  PROMOTER: "Promoter",
  CLIENT: "Private customer",
  COMPANY: "Company",
  VENUE_CONTACT: "Venue contact",
  COLLABORATOR: "Collaborator",
  OTHER: "Other",
};

export const CONTACT_TYPE_PLURALS: Record<ContactType, string> = {
  PROMOTER: "Promoters",
  CLIENT: "Private customers",
  COMPANY: "Companies",
  VENUE_CONTACT: "Venue contacts",
  COLLABORATOR: "Collaborators",
  OTHER: "Others",
};

export const PAYMENT_KINDS = ["DEPOSIT", "BALANCE", "SETTLEMENT", "EXPENSE", "OTHER"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  DEPOSIT: "Deposit",
  BALANCE: "Balance",
  SETTLEMENT: "Artist settlement",
  EXPENSE: "Expense",
  OTHER: "Other",
};

export const CHECK_IN_KINDS = ["ON_THE_WAY", "ARRIVED", "DEPARTED"] as const;
export type CheckInKind = (typeof CHECK_IN_KINDS)[number];

export const CHECK_IN_KIND_LABELS: Record<CheckInKind, string> = {
  ON_THE_WAY: "On the way",
  ARRIVED: "Arrived",
  DEPARTED: "Left venue",
};

export const ROLES = ["ADMIN", "AGENT", "ARTIST"] as const;
export type Role = (typeof ROLES)[number];

export const CURRENCIES = ["GBP", "EUR", "USD", "AUD", "CAD", "CHF", "SEK", "NOK", "DKK", "JPY"] as const;

export const TIMEZONES = [
  "Europe/London",
  "Europe/Dublin",
  "Europe/Lisbon",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Rome",
  "Europe/Stockholm",
  "Europe/Athens",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Dubai",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Pacific/Auckland",
  "UTC",
] as const;

// Statuses that mean a show is going ahead (used for clash checks and arrival tracking).
export const LIVE_STATUSES: BookingStatus[] = ["HOLD", "PENDING", "AWAITING", "CONFIRMED", "SETTLED"];

/** The act's name, or "Needs an act" for a gig still being set up. */
export function actName(b: { artist?: { name: string } | null }) {
  return b.artist?.name ?? "Needs an act";
}
