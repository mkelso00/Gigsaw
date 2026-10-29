import Link from "next/link";
import { Icon } from "@/components/icons";

// Settings pages, laid out like Shopify's admin: a narrow centred column, a big title, then
// sections with a heading and short description above a card of rows or fields.

/** The settings menu: one page each. Shown in the sidebar while in Settings. */
export const SETTINGS_PAGES: { href: string; label: string; icon: string; hint: string }[] = [
  { href: "/settings/general", label: "General", icon: "company", hint: "Business name, contact details, time zone and currency" },
  { href: "/settings/plan", label: "Plan", icon: "billing", hint: "Your Gigsaw plan and this month's bill" },
  { href: "/settings/users", label: "Internal users", icon: "contacts", hint: "Admins and agents who log in to make bookings" },
  { href: "/settings/notifications", label: "Notifications", icon: "bell", hint: "Emails and texts to acts, customers and your team" },
  { href: "/settings/booking-fee", label: "Booking fee", icon: "payments", hint: "A fee on top for venues or clients, all yours" },
  { href: "/settings/arrivals", label: "Arrivals and alerts", icon: "arrivals", hint: "Late arrivals, grace period and venue radius" },
  { href: "/settings/reminders", label: "Act reminders", icon: "clock", hint: "Weekly gig list and on-the-day reminders" },
  { href: "/settings/weddings", label: "Weddings and events", icon: "heart", hint: "Planner emails, customer confirmations and reviews" },
  { href: "/settings/documents", label: "Contracts and invoices", icon: "doc", hint: "Wording added to every contract and invoice" },
  { href: "/settings/demo", label: "Demo data", icon: "sparkle", hint: "Sample acts, venues and bookings to try things out" },
];

export function SettingsPage({
  title,
  children,
  actions,
  back,
}: {
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** The page one level up, shown as a small link above the title. */
  back?: { href: string; label: string };
}) {
  return (
    <div className="mx-auto max-w-[880px] pb-16">
      {back && (
        <Link href={back.href} className="-mt-2 mb-2 inline-flex items-center gap-1 text-sm text-ink-500 hover:text-ink-950">
          <Icon name="back" className="h-4 w-4" />
          {back.label}
        </Link>
      )}
      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-ink-950">{title}</h1>
        {actions}
      </div>
      <div className="space-y-9">{children}</div>
    </div>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6">
      {title && (
        <div className="mb-3">
          <h2 className="text-[15px] font-semibold text-ink-950">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-ink-500">{description}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A white card. Rows inside are divided by hairlines. */
export function SettingsCard({ children, pad = false, className = "" }: { children: React.ReactNode; pad?: boolean; className?: string }) {
  return <div className={`card divide-y divide-ink-100 overflow-hidden ${pad ? "p-5" : ""} ${className}`}>{children}</div>;
}

/** One row: icon, title, a line underneath, and what's on the right (a badge, button or chevron). */
export function SettingsRow({
  icon,
  title,
  sub,
  href,
  right,
}: {
  icon?: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  href?: string;
  right?: React.ReactNode;
}) {
  const body = (
    <>
      {icon && <Icon name={icon} className="mt-0.5 h-5 w-5 shrink-0 text-ink-600" />}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-ink-950">{title}</span>
        {sub && <span className="mt-0.5 block text-sm text-ink-500">{sub}</span>}
      </span>
      {href && <Icon name="chevron" className="h-4 w-4 shrink-0 text-ink-400" />}
      {/* On a phone, buttons and badges drop under the text rather than squashing it. */}
      {right && <span className={`w-full sm:w-auto sm:shrink-0 ${icon ? "pl-[34px] sm:pl-0" : ""}`}>{right}</span>}
    </>
  );
  return href ? (
    <Link href={href} className="flex flex-wrap items-start gap-x-3.5 gap-y-3 px-5 py-4 transition-colors hover:bg-ink-50 sm:flex-nowrap">
      {body}
    </Link>
  ) : (
    <div className="flex flex-wrap items-start gap-x-3.5 gap-y-3 px-5 py-4 sm:flex-nowrap">{body}</div>
  );
}

/**
 * A switch row. Sends "<name>__shown" so turning it off is saved too. Anything in `children`
 * (e.g. the day and time for a reminder) only shows while the switch is on.
 */
export function SettingsToggle({
  name,
  defaultChecked,
  label,
  hint,
  children,
}: {
  name: string;
  defaultChecked: boolean;
  label: string;
  hint?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const row = (
    <label className="flex cursor-pointer items-start justify-between gap-4 px-5 py-4 hover:bg-ink-50">
      <input type="hidden" name={`${name}__shown`} value="1" />
      <span>
        <span className="block text-sm font-medium text-ink-950">{label}</span>
        {hint && <span className="mt-0.5 block text-sm text-ink-500">{hint}</span>}
      </span>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="switch mt-0.5" data-toggle />
    </label>
  );
  if (!children) return row;
  // Hidden with CSS rather than removed, so the fields are still sent (and kept) while the switch is off.
  return (
    <div className="group/toggle divide-y divide-ink-100">
      {row}
      <div className="group-has-[[data-toggle]:not(:checked)]/toggle:hidden">{children}</div>
    </div>
  );
}

export function Badge({ children, tone = "grey" }: { children: React.ReactNode; tone?: "grey" | "green" | "red" | "amber" }) {
  const tones = {
    grey: "bg-ink-100 text-ink-700",
    green: "bg-emerald-100 text-emerald-800",
    red: "bg-rose-100 text-rose-800",
    amber: "bg-amber-100 text-amber-800",
  };
  return <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
