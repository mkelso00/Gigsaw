// An act's profile and bank details: filled in by the act on the join link, or by the agency
// on the act's edit page. Bank details are only ever shown to the agency.

import { FormError, str } from "./forms";
import { toMinor } from "./money";

export const ACT_TYPES = ["SOLO", "DUO", "BAND", "DJ", "OTHER"] as const;
export const ACT_TYPE_LABELS: Record<(typeof ACT_TYPES)[number], string> = {
  SOLO: "Solo",
  DUO: "Duo",
  BAND: "Band",
  DJ: "DJ",
  OTHER: "Other",
};

const url = (s: string) => (!s ? "" : /^https?:\/\//i.test(s) ? s : `https://${s}`);

/** UK sort code as 12-34-56, or whatever was typed if it isn't one. */
export function formatSortCode(s: string) {
  const d = s.replace(/\D/g, "");
  return d.length === 6 ? `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}` : s.trim();
}

export function parseActProfile(form: FormData, currency = "GBP") {
  const type = str(form, "actType").toUpperCase();
  let usualFeeMinor: number | null = null;
  if (str(form, "usualFee")) {
    try {
      usualFeeMinor = toMinor(str(form, "usualFee"), currency);
    } catch {
      throw new FormError("Usual fee: use numbers only, like 150");
    }
    if (usualFeeMinor < 0) throw new FormError("The fee can't be negative");
  }
  const accountNumber = str(form, "bankAccountNumber").replace(/\s/g, "");
  if (accountNumber && !/^\d{6,10}$/.test(accountNumber)) throw new FormError("Check the account number: it should be 8 digits");
  const sortCode = formatSortCode(str(form, "bankSortCode"));
  if (sortCode && !/^\d{2}-\d{2}-\d{2}$/.test(sortCode)) throw new FormError("Check the sort code: it should be 6 digits, like 12-34-56");
  const vatRegistered = str(form, "vatRegistered") === "on";
  return {
    actType: (ACT_TYPES as readonly string[]).includes(type) ? type : "",
    town: str(form, "town"),
    photoUrl: url(str(form, "photoUrl")),
    videoUrl: url(str(form, "videoUrl")),
    instagram: str(form, "instagram").replace(/^@/, ""),
    website: url(str(form, "website")),
    setList: str(form, "setList"),
    usualFeeMinor,
    bankAccountName: str(form, "bankAccountName"),
    bankSortCode: sortCode,
    bankAccountNumber: accountNumber,
    vatRegistered,
    vatNumber: vatRegistered ? str(form, "vatNumber") : "",
  };
}

export type JoinMember = { name: string; email: string; phone: string; role: string };

/** Band members from the join form: rows of member_name / member_email / member_phone / member_role. */
export function parseMembers(form: FormData): JoinMember[] {
  const names = form.getAll("member_name").map(String);
  const emails = form.getAll("member_email").map(String);
  const phones = form.getAll("member_phone").map(String);
  const roles = form.getAll("member_role").map(String);
  return names
    .map((n, i) => ({ name: n.trim(), email: (emails[i] ?? "").trim().toLowerCase(), phone: (phones[i] ?? "").trim(), role: (roles[i] ?? "").trim() }))
    .filter((m) => m.name)
    .slice(0, 20);
}
