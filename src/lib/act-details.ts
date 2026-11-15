// An act's pay details: bank account, postal address and National Insurance number, with VAT.
// The act fills them in from their app (Your details) the first time they sign in, and admins can
// change them on the act's edit page. Gigsaw needs them to make the act's self-billing invoices.
//
// Who sees them: the act themself and the agency's admins. Never agents, venues, customers, other
// acts, calendar feeds or emails (the bank change notice to the agency only names the last digits).
//
// `detailsCompletedAt` is set when every required detail is in and cleared when one is taken out,
// so "details missing" is simply `detailsCompletedAt == null`.

import { FormError, str } from "./forms";

export const NI_HINT = "This is for our records only.";
export const PAY_REASON = "This is how you'll get paid from now on.";

export type PayDetails = { bankAccountName: string; bankSortCode: string; bankAccountNumber: string; address: string; niNumber: string };

export type PayFields = PayDetails & { phone: string; vatRegistered: boolean; vatNumber: string };

/** A UK sort code as 12-34-56, from "123456", "12 34 56" or "12-34-56". Null if it isn't 6 digits. */
export function parseSortCode(s: string): string | null {
  const d = s.replace(/[\s-]/g, "");
  return /^\d{6}$/.test(d) ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` : null;
}

/** A UK account number: 8 digits, spaces and dashes ignored. Null if it isn't one. */
export function parseAccountNumber(s: string): string | null {
  const d = s.replace(/[\s-]/g, "");
  return /^\d{8}$/.test(d) ? d : null;
}

// HMRC's rules: two letters, six digits and A, B, C or D. The first letter is never D, F, I, Q, U
// or V, the second never D, F, I, O, Q, U or V, and a few pairs are never given out (QQ 12 34 56 C
// is HMRC's own example, so it doesn't pass).
const NI = /^(?!BG|GB|KN|NK|NT|TN|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/;

/** A National Insurance number, stored as AB123456C (any spacing or case accepted). Null if it isn't one. */
export function parseNiNumber(s: string): string | null {
  const v = s.replace(/[\s-]/g, "").toUpperCase();
  return NI.test(v) ? v : null;
}

/** AB123456C as AB 12 34 56 C, the way it's printed on letters. */
export function formatNi(ni: string) {
  const v = ni.replace(/\s/g, "");
  return v.length === 9 ? `${v.slice(0, 2)} ${v.slice(2, 4)} ${v.slice(4, 6)} ${v.slice(6, 8)} ${v.slice(8)}` : ni;
}

/** Only the last three characters, e.g. •• •• •• 56 C, so it can be recognised but not copied. */
export function maskNi(ni: string) {
  const v = ni.replace(/\s/g, "");
  if (!v) return "";
  return `•• •• •• ${v.slice(-3, -1)} ${v.slice(-1)}`;
}

/** Only the last four digits, e.g. ••••5678. */
export function maskAccount(n: string) {
  return n ? `••••${n.slice(-4)}` : "";
}

/** The last two digits of a sort code, e.g. ••-••-56. */
export function maskSortCode(s: string) {
  return s ? `••-••-${s.slice(-2)}` : "";
}

/** A UK VAT number as GB123456789, from "GB 123 4567 89" or "123456789". Null if it isn't one. */
export function parseVatNumber(s: string): string | null {
  const v = s.replace(/[\s-]/g, "").toUpperCase();
  const m = /^(GB)?(\d{9}|\d{12})$/.exec(v);
  return m ? `GB${m[2]}` : null;
}

/** What's still missing, in words, e.g. ["bank details", "address"]. Empty when everything is in. */
export function missingDetails(a: PayDetails): string[] {
  const out: string[] = [];
  if (!a.bankAccountName.trim() || !a.bankSortCode.trim() || !a.bankAccountNumber.trim()) out.push("bank details");
  if (!a.address.trim()) out.push("address");
  if (!a.niNumber.trim()) out.push("National Insurance number");
  return out;
}

export function detailsComplete(a: PayDetails) {
  return missingDetails(a).length === 0;
}

/** True when the act has to fill in their details before using the app. */
export function needsDetails(a: PayDetails & { detailsCompletedAt: Date | null }) {
  return !a.detailsCompletedAt || !detailsComplete(a);
}

/** When the details count as complete after a save: kept if they already were, now if they just became so, else null. */
export function completedAt(after: PayDetails, before: Date | null, now = new Date()) {
  return detailsComplete(after) ? (before ?? now) : null;
}

/** True when the bank account is being changed from one that was already on file (not filled in for the first time). */
export function bankChanged(before: PayDetails, after: PayDetails) {
  const had = !!(before.bankAccountName || before.bankSortCode || before.bankAccountNumber);
  if (!had) return false;
  return (
    before.bankAccountName.trim() !== after.bankAccountName.trim() ||
    before.bankSortCode !== after.bankSortCode ||
    before.bankAccountNumber !== after.bankAccountNumber
  );
}

/** Joins a postal address typed over several lines into tidy lines, without blank ones. */
export function tidyAddress(s: string) {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .join("\n");
}

/**
 * Read the pay details from a form. A field that isn't in the form at all is kept as it was:
 * bank details and the NI number only appear once the person presses Change, so leaving them
 * alone keeps what's on file without the full numbers ever being sent to the page.
 *
 * `required` (the act's own form): address, NI number and bank details must all be there.
 * Otherwise (an admin's edit) a field can be left blank, but whatever is typed must be right.
 */
export function readPayFields(form: FormData, before: PayFields, { required }: { required: boolean }): PayFields {
  const has = (k: string) => form.has(k);
  const out: PayFields = { ...before };

  if (has("address")) out.address = tidyAddress(String(form.get("address") ?? "")).slice(0, 500);
  if (required && !out.address) throw new FormError("Add your postal address");

  if (has("niNumber")) {
    const raw = str(form, "niNumber");
    if (!raw && !required) out.niNumber = "";
    else {
      const ni = parseNiNumber(raw);
      if (!ni) throw new FormError("Check the National Insurance number: two letters, six numbers and a letter, like QQ 12 34 56 C");
      out.niNumber = ni;
    }
  }
  if (required && !out.niNumber) throw new FormError("Add your National Insurance number");

  if (has("bankAccountNumber") || has("bankSortCode") || has("bankAccountName")) {
    const name = str(form, "bankAccountName").slice(0, 120);
    const rawSort = str(form, "bankSortCode");
    const rawAccount = str(form, "bankAccountNumber");
    if (!required && !name && !rawSort && !rawAccount) {
      out.bankAccountName = out.bankSortCode = out.bankAccountNumber = "";
    } else {
      if (!name) throw new FormError("Add the name on the bank account");
      const sort = parseSortCode(rawSort);
      if (!sort) throw new FormError("Check the sort code: it should be 6 numbers, like 12-34-56");
      const account = parseAccountNumber(rawAccount);
      if (!account) throw new FormError("Check the account number: it should be 8 numbers");
      Object.assign(out, { bankAccountName: name, bankSortCode: sort, bankAccountNumber: account });
    }
  }
  if (required && !(out.bankAccountName && out.bankSortCode && out.bankAccountNumber)) throw new FormError("Add your bank details");

  if (has("phone")) out.phone = str(form, "phone").slice(0, 40);

  // The tick box only says whether it's ticked, so it's read when the VAT number field is there too.
  if (has("vatNumber")) {
    out.vatRegistered = str(form, "vatRegistered") === "on";
    const raw = str(form, "vatNumber");
    // An admin can tick VAT registered before they have the number; the act is asked for it.
    if (out.vatRegistered && (raw || required)) {
      const vat = parseVatNumber(raw);
      if (!vat) throw new FormError("Check the VAT number: 9 numbers, like GB 123 4567 89. Or untick VAT registered.");
      out.vatNumber = vat;
    } else out.vatNumber = out.vatRegistered ? raw : "";
  }
  return out;
}
