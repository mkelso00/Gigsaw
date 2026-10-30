import { HeaderActions } from "@/components/header-actions";
import Link from "next/link";
import { ARRIVAL_STATE_LABELS, ARRIVAL_STATE_STYLES, type ArrivalState } from "@/lib/arrival";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_STYLES, type BookingStatus } from "@/lib/constants";

export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4 sm:mb-8 sm:flex-wrap sm:items-end">
      <div className="min-w-0">
        {eyebrow && <div className="eyebrow mb-2">{eyebrow}</div>}
        <h1 className="text-[26px] leading-tight font-bold tracking-[-0.015em] text-ink-950 sm:text-[30px]">{title}</h1>
        {/* The description is hidden on phones to keep the top of the page short. */}
        {subtitle && <p className="mt-1.5 hidden max-w-2xl text-[15px] text-ink-500 sm:block">{subtitle}</p>}
      </div>
      {actions && <HeaderActions>{actions}</HeaderActions>}
    </div>
  );
}

function Dot() {
  return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--dot)]" />;
}

export function StatusBadge({ status }: { status: string }) {
  const s = status as BookingStatus;
  return (
    <span className={`badge ${BOOKING_STATUS_STYLES[s] ?? "bg-ink-100"}`}>
      <Dot />
      {BOOKING_STATUS_LABELS[s] ?? status}
    </span>
  );
}

export function ArrivalBadge({ state }: { state: ArrivalState }) {
  return (
    <span className={`badge ${ARRIVAL_STATE_STYLES[state]}`}>
      <Dot />
      {ARRIVAL_STATE_LABELS[state]}
    </span>
  );
}

export function Stat({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  href?: string;
  tone?: "default" | "dark" | "alert";
}) {
  const tones = {
    default: "card",
    dark: "rounded-[var(--radius-card)] bg-ink-950 text-white",
    alert: "rounded-[var(--radius-card)] bg-rose-600 text-white",
  };
  const body = (
    <div className={`${tones[tone]} h-full p-4 sm:p-5`}>
      {/* Labelled like a channel on a desk, with its light, and the number as a readout. */}
      <div
        className={`flex items-center gap-2 font-mono text-[10.5px] font-medium tracking-[0.12em] uppercase ${tone === "default" ? "text-ink-500" : "text-white/70"}`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === "alert" ? "bg-white" : "bg-volt-400 shadow-[0_0_6px_var(--color-volt-400)]"}`}
          aria-hidden
        />
        <span className="truncate">{label}</span>
      </div>
      <div
        className={`mt-2.5 text-[22px] leading-none font-semibold tracking-[-0.03em] tabular-nums sm:mt-3 sm:text-[28px] ${tone === "dark" ? "text-volt-300" : ""}`}
      >
        {value}
      </div>
      {hint && <div className={`mt-2 text-xs ${tone === "default" ? "text-ink-500" : "text-white/60"}`}>{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-[var(--radius-card)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_-12px_rgb(0_0_0/0.25)]">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[var(--radius-card)] border border-dashed border-ink-300 bg-white/50 p-10 text-center text-sm text-ink-500">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
  className = "",
  htmlFor,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** For a field with its own buttons or list (e.g. a Combobox): the label points at the box instead of wrapping it. */
  htmlFor?: string;
}) {
  if (htmlFor)
    return (
      <div className={`block ${className}`}>
        <label htmlFor={htmlFor} className="label">
          {label}
        </label>
        {children}
        {hint && <span className="hint block">{hint}</span>}
      </div>
    );
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint block">{hint}</span>}
    </label>
  );
}

export function ArtistDot({ colour }: { colour: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white" style={{ backgroundColor: colour }} />;
}

export function DefinitionList({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-5 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-ink-500">{k}</dt>
          <dd className="mt-1 whitespace-pre-line text-ink-950">{v || <span className="text-ink-300">Not set</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A heading row for a section, with an optional link or action on the right. */
export function SectionHeading({ title, action }: { title: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="section-title">{title}</h2>
      {action}
    </div>
  );
}
