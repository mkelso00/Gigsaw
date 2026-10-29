import { CURRENCY } from "@/lib/plans";

/** "£49" for whole pounds, "£40.83" otherwise: prices read better without ".00". */
export function price(minor: number) {
  const digits = minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: CURRENCY, minimumFractionDigits: digits, maximumFractionDigits: digits }).format(
    minor / 100,
  );
}

export function signupHref(plan: string, interval: "month" | "year" = "month") {
  return `/signup?plan=${plan}${interval === "year" ? "&interval=year" : ""}`;
}
