// Reading the Owner area's price fields for a business billed by invoice.

import { FormError, required, str } from "./forms";
import { toMinor } from "./money";

export function priceFrom(form: FormData, currency: string) {
  try {
    const minor = toMinor(required(form, "pricePerGig", "Price per booking"), currency);
    if (minor < 0) throw new FormError("Price can't be negative");
    return minor;
  } catch (e) {
    if (e instanceof FormError) throw e;
    throw new FormError("Enter the price per booking as a number, like 2.50");
  }
}

/** Internal users included, and the yearly price of each extra one. */
export function seatsFrom(form: FormData, currency: string) {
  const included = Number(str(form, "includedUsers") || "2");
  if (!Number.isInteger(included) || included < 0 || included > 1000) throw new FormError("Included internal users must be a whole number");
  let yearly = 0;
  try {
    yearly = toMinor(str(form, "extraUserYearly") || "0", currency);
  } catch {
    throw new FormError("Enter the yearly price per extra user as a number, like 500");
  }
  if (yearly < 0) throw new FormError("Price can't be negative");
  return { includedUsers: included, extraUserYearlyMinor: yearly };
}
