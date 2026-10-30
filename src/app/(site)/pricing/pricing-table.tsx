"use client";

import Link from "next/link";
import { useState } from "react";
import { monthsFree, yearlySavingLabel, type Plan } from "@/lib/plans";
import { planColumns, price, signupHref } from "../format";
import { Check } from "../site-ui";

type Interval = "month" | "year";

export function PricingTable({
  plans,
  featured,
  extraUserMonthlyMinor,
  extraUserYearlyMinor,
  trialDays,
}: {
  plans: Plan[];
  /** The plan shown as the dark card. */
  featured: string | null;
  extraUserMonthlyMinor: number;
  extraUserYearlyMinor: number;
  trialDays: number;
}) {
  const [interval, setPeriod] = useState<Interval>("month");
  const yearly = interval === "year";
  const saving = yearlySavingLabel(plans);

  return (
    <div>
      <div className="flex justify-center">
        <div role="group" aria-label="Billing period" className="inline-flex rounded-full border border-ink-200 bg-ink-50 p-1">
          {(
            [
              ["month", "Monthly"],
              ["year", "Yearly"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setPeriod(value)}
              aria-pressed={interval === value}
              className={`flex h-10 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-volt-400 focus-visible:outline-none ${
                interval === value ? "bg-ink-950 text-white" : "text-ink-600 hover:text-ink-950"
              }`}
            >
              {label}
              {value === "year" && saving && (
                <span className={`rounded-full px-2 py-0.5 text-xs ${interval === value ? "bg-volt-400 text-ink-950" : "bg-volt-200 text-ink-900"}`}>
                  {saving}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={`mt-10 grid gap-5 ${planColumns(plans.length, "lg")}`}>
        {plans.map((p) => {
          // The middle plan gets the dark card simply to break up three identical boxes.
          const dark = p.key === featured;
          const free = monthsFree(p);
          return (
            <div
              key={p.key}
              className={`flex flex-col rounded-3xl border p-7 sm:p-8 ${dark ? "border-ink-950 bg-ink-950 text-white" : "border-ink-200 bg-white text-ink-950"}`}
            >
              <h3 className="text-2xl font-semibold tracking-tight">{p.name}</h3>
              <p className={`mt-2 lg:min-h-12 ${dark ? "text-ink-300" : "text-ink-600"}`}>{p.tagline}</p>

              <div className="mt-8">
                <p className="flex items-baseline gap-1.5">
                  <span className="text-5xl font-semibold tracking-[-0.03em]">{price(yearly ? p.yearlyMinor : p.monthlyMinor)}</span>
                  <span className={dark ? "text-ink-300" : "text-ink-500"}>{yearly ? "a year" : "a month"}</span>
                </p>
                <p className={`mt-2 h-5 text-sm ${dark ? "text-ink-400" : "text-ink-500"}`}>
                  {yearly
                    ? `Works out at ${price(Math.round(p.yearlyMinor / 12))} a month`
                    : `Or ${price(p.yearlyMinor)} a year${free ? `, ${free} month${free === 1 ? "" : "s"} free` : ""}`}
                </p>
              </div>

              <p className={`mt-7 border-y py-4 font-medium ${dark ? "border-white/10" : "border-ink-200"}`}>
                {p.gigsPerMonth === null ? "Unlimited bookings" : `Up to ${p.gigsPerMonth} bookings a month`}
                <span className={`block text-sm font-normal ${dark ? "text-ink-400" : "text-ink-500"}`}>
                  {p.includedUsers} internal users included, then {yearly ? `${price(extraUserYearlyMinor)} a year` : `${price(extraUserMonthlyMinor)} a month`}{" "}
                  each
                </span>
              </p>

              <ul className="mt-6 flex-1 space-y-3">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-3">
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${dark ? "bg-volt-400 text-ink-950" : "bg-ink-100 text-ink-950"}`}
                    >
                      <Check className="h-3 w-3" />
                    </span>
                    <span className={dark ? "text-ink-200" : "text-ink-700"}>{h}</span>
                  </li>
                ))}
              </ul>

              <Link href={signupHref(p.key, interval)} className={`btn mt-9 h-12 text-base ${dark ? "btn-volt" : "btn-primary"}`}>
                Try {p.name} free
              </Link>
              <p className={`mt-3 text-center text-sm ${dark ? "text-ink-400" : "text-ink-500"}`}>Try free for {trialDays} days</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
