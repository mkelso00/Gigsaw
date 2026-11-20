// The self-billing agreement. Under HMRC's rules for self-billing (VAT Notice 700/62) the agency may only make out an
// act's invoices for them if the act has agreed to it in writing, and the agreement is normally reviewed every 12
// months. So the payee (src/lib/payee.ts) ticks the agreement when they give their pay details in the act app, Gigsaw
// keeps when they agreed and the exact wording, and asks again 12 months later.
//
// An invoice is still made while there's no current agreement, so nobody's pay is held up; staff see "No self-billing
// agreement" on Pay acts and on the act's page, and the weekly reminder (src/lib/pay-details-chase.ts) asks the act to
// agree. Only the act can agree: staff can see it but never tick it for them. Kept pure (no database) for the tests.

/** Months an agreement lasts before the act is asked to agree again. */
export const SELF_BILLING_MONTHS = 12;

/** Gigsaw's own wording. {business} is the business's name. A business can write its own in Settings, Contracts and invoices. */
export const DEFAULT_SELF_BILLING_TEXT =
  "{business} will make out invoices for my gigs on my behalf (self-billing). I won't issue my own invoices for these gigs, and I'll tell {business} if my VAT registration changes.";

/** The wording an act agrees to: the business's own (from Settings) or Gigsaw's, with the business's name filled in. */
export function selfBillingWording(custom: string | null | undefined, business: string) {
  const text = (custom ?? "").replace(/\r\n?/g, "\n").trim() || DEFAULT_SELF_BILLING_TEXT;
  return text.replace(/\{business\}/g, business.trim() || "The agency");
}

/** When an agreement made at `agreedAt` needs agreeing again: 12 calendar months on. */
export function agreementRenewsAt(agreedAt: Date) {
  const d = new Date(agreedAt);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + SELF_BILLING_MONTHS, 1);
  // 29 February plus a year is 28 February, not 1 March.
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export type AgreementState = "none" | "current" | "expired";

/** No agreement at all, one still in force, or one more than 12 months old. */
export function agreementState(agreedAt: Date | null | undefined, now = new Date()): AgreementState {
  if (!agreedAt) return "none";
  return agreementRenewsAt(agreedAt) > now ? "current" : "expired";
}

export function agreementCurrent(agreedAt: Date | null | undefined, now = new Date()) {
  return agreementState(agreedAt, now) === "current";
}

/** The agreement an invoice made now is issued under: its date, or null when there's no current one. */
export function agreementInForce(payee: { selfBillingAgreedAt?: Date | null } | null | undefined, now = new Date()): Date | null {
  const at = payee?.selfBillingAgreedAt ?? null;
  return at && agreementCurrent(at, now) ? at : null;
}

/** Why the act is asked to agree, for staff and the act, or null when the agreement is current. */
export function agreementNeeded(agreedAt: Date | null | undefined, now = new Date()): string | null {
  const s = agreementState(agreedAt, now);
  if (s === "none") return "No self-billing agreement";
  if (s === "expired") return "Self-billing agreement more than 12 months old";
  return null;
}

/** The line on the printed invoice. */
export function issuedUnderLine(agreedOn: string) {
  return `Issued under the self-billing agreement of ${agreedOn}.`;
}

/** "20 November 2026": the agreement's date as it's written on an invoice. */
export function agreementDate(d: Date, timeZone = "Europe/London") {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "long", year: "numeric" }).format(d);
}
