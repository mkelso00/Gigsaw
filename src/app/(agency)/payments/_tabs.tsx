import Link from "next/link";

// Payments and Pay acts share one row of tabs, so paying acts still sits beside collecting money in.
const TABS = [
  ["collect", "To collect", "/payments?tab=collect"],
  ["pay", "Pay acts", "/payments/acts"],
  ["history", "Payments log", "/payments?tab=history"],
] as const;

export function PaymentsTabs({ on }: { on: (typeof TABS)[number][0] }) {
  return (
    <div className="inline-flex gap-1 rounded-xl border border-ink-200 bg-white p-1 text-sm" role="tablist" aria-label="Payments">
      {TABS.map(([t, label, href]) => (
        <Link key={t} href={href} className={`rounded-lg px-3.5 py-2 font-medium ${on === t ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100"}`}>
          {label}
        </Link>
      ))}
    </div>
  );
}
