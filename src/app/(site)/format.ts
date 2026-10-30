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

/** Grid columns for a row of plan cards, however many plans the owner has put on the website. */
export function planColumns(count: number, at: "md" | "lg") {
  if (count <= 1) return "mx-auto max-w-md";
  if (count === 2) return at === "md" ? "md:grid-cols-2" : "lg:grid-cols-2";
  if (count === 3) return at === "md" ? "md:grid-cols-3" : "lg:grid-cols-3";
  return at === "md" ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2 xl:grid-cols-4";
}
