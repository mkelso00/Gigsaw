import type { BookingPageData } from "../_data";

export function ChecklistSection({ checklist }: { checklist: BookingPageData["checklist"] }) {
  return (
    <section className="card card-pad">
      <h2 className="section-title mb-3">Checklist</h2>
      <ul className="space-y-2 text-sm">
        {checklist.map((c) => (
          <li key={c.label} className="flex gap-2">
            <span
              className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                c.level === "ok" ? "bg-emerald-500" : c.level === "warning" ? "bg-amber-500" : "bg-rose-600"
              }`}
            >
              {c.level === "ok" ? "✓" : "!"}
            </span>
            <span>
              {c.label}
              {c.detail && <span className="block text-xs text-slate-500">{c.detail}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
