import Link from "next/link";

/** Shown on Owner pages that need Stripe when it isn't connected yet. */
export function StripeNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-8 flex items-start gap-3 rounded-[var(--radius-card)] border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-950">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-hidden />
      <span>
        {children}{" "}
        <Link href="/owner/stripe" className="link">
          Connect Stripe
        </Link>
      </span>
    </div>
  );
}

/** A calm note at the top of a page, with a teal light. */
export function OwnerNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-8 flex items-start gap-3 rounded-[var(--radius-card)] border border-volt-200 bg-volt-100 px-5 py-4 text-sm text-ink-900">
      <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-volt-500 shadow-[0_0_6px_var(--color-volt-400)]" aria-hidden />
      <span>{children}</span>
    </div>
  );
}
