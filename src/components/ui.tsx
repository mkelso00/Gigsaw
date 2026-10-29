import Link from "next/link";
import { ARRIVAL_STATE_LABELS, ARRIVAL_STATE_STYLES, type ArrivalState } from "@/lib/arrival";
import { BOOKING_STATUS_LABELS, BOOKING_STATUS_STYLES, type BookingStatus } from "@/lib/constants";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const s = status as BookingStatus;
  return <span className={`badge ${BOOKING_STATUS_STYLES[s] ?? "bg-slate-100"}`}>{BOOKING_STATUS_LABELS[s] ?? status}</span>;
}

export function ArrivalBadge({ state }: { state: ArrivalState }) {
  return <span className={`badge ${ARRIVAL_STATE_STYLES[state]}`}>{ARRIVAL_STATE_LABELS[state]}</span>;
}

export function Stat({ label, value, hint, href }: { label: string; value: React.ReactNode; hint?: React.ReactNode; href?: string }) {
  const body = (
    <div className="card card-pad h-full">
      <div className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:-translate-y-0.5">
      {body}
    </Link>
  ) : (
    body
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="hint block">{hint}</span>}
    </label>
  );
}

export function ArtistDot({ colour }: { colour: string }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colour }} />;
}

export function DefinitionList({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium tracking-wide text-slate-500 uppercase">{k}</dt>
          <dd className="mt-0.5 whitespace-pre-line text-slate-900">{v || <span className="text-slate-400">Not set</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
