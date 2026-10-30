import Link from "next/link";

/** Switch between people and companies, like Overture's Contacts. */
export function ContactsTabs({ active }: { active: "people" | "companies" }) {
  const tab = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      aria-current={on ? "page" : undefined}
      className={`-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors ${on ? "border-ink-950 text-ink-950" : "border-transparent text-ink-500 hover:text-ink-950"}`}
    >
      {label}
    </Link>
  );
  return (
    <div className="mb-6 flex gap-6 overflow-x-auto border-b border-ink-200 whitespace-nowrap">
      {tab("/people", "People", active === "people")}
      {tab("/contacts", "Companies & customers", active === "companies")}
      {tab("/venues", "Venues", false)}
    </div>
  );
}
