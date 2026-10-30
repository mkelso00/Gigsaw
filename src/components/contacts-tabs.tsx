import Link from "next/link";

/** Switch between people and companies, like Overture's Contacts. */
export function ContactsTabs({ active }: { active: "people" | "companies" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      className={`rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${on ? "bg-ink-950 text-white" : "text-ink-600 hover:bg-ink-100 hover:text-ink-950"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="mb-6 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-ink-200 bg-white p-1 whitespace-nowrap sm:inline-flex">
      {tab("/people", "People", active === "people")}
      {tab("/contacts", "Companies & customers", active === "companies")}
      <Link href="/venues" className="rounded-lg px-3.5 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 hover:text-ink-950">
        Venues
      </Link>
    </div>
  );
}
