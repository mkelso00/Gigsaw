// Internal users (admins and agents) are charged per business: a number are included in the
// price and each extra one costs a yearly amount, billed monthly at a twelfth.

export const INTERNAL_ROLES = ["ADMIN", "AGENT"];

export function userCharge(a: { includedUsers: number; extraUserYearlyMinor: number }, users: number) {
  const extra = Math.max(0, users - a.includedUsers);
  const yearlyMinor = extra * a.extraUserYearlyMinor;
  return { users, extra, yearlyMinor, monthlyMinor: Math.round(yearlyMinor / 12) };
}
