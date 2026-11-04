import Link from "next/link";
import { Logo } from "@/components/logo";

// The calm pages shown when something breaks or a page can't be found. Laid out like a desk
// readout: a mono label with a level meter, a short heading, one line on what to do, the way
// back, and (for errors) a reference people can quote. The error boundaries in error-pages.tsx
// and every not-found page build on these.

export type ProblemTone = "light" | "dark";

/**
 * A row of level lights. "clip" lights them all, with the last one in cue magenta like a
 * channel that's peaked; "silent" leaves them dark, like a channel with no signal.
 */
function Meter({ state, tone }: { state: "clip" | "silent"; tone: ProblemTone }) {
  const off = tone === "dark" ? "bg-white/[0.08]" : "bg-ink-200";
  return (
    <span className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`h-2 w-[5px] rounded-[1px] ${state === "silent" ? off : i >= 8 ? "bg-cue-500" : "bg-volt-400"}`} />
      ))}
    </span>
  );
}

export function Problem({
  tone = "light",
  state,
  label,
  title,
  children,
  actions,
  reference,
  detail,
}: {
  tone?: ProblemTone;
  /** "clip" for errors, "silent" for pages and links that aren't there. */
  state: "clip" | "silent";
  label: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  /** The error digest, so someone can quote it and we can find the matching server log. */
  reference?: string;
  /** Only ever passed in development: the error message, to save opening the terminal. */
  detail?: string;
}) {
  const dark = tone === "dark";
  return (
    <div className="motion-page-in mx-auto max-w-md py-14 text-center sm:py-24">
      <div className="flex flex-col items-center gap-3">
        <Meter state={state} tone={tone} />
        <p className={`font-mono text-[11px] font-medium tracking-[0.14em] uppercase ${dark ? "text-ink-400" : "text-ink-500"}`}>{label}</p>
      </div>
      <h1 className={`mt-4 text-[26px] leading-tight font-bold tracking-[-0.015em] sm:text-[30px] ${dark ? "text-white" : "text-ink-950"}`}>{title}</h1>
      <p className={`mt-3 text-[15px] leading-relaxed ${dark ? "text-ink-400" : "text-ink-600"}`}>{children}</p>
      {actions && <div className="mt-8 flex flex-col-reverse items-stretch gap-2 sm:flex-row sm:justify-center">{actions}</div>}
      {reference && (
        <p className="mt-8 font-mono text-xs text-ink-500">
          Reference: <span className={`select-all ${dark ? "text-ink-300" : "text-ink-700"}`}>{reference}</span>
        </p>
      )}
      {detail && (
        <pre className="mt-6 overflow-x-auto rounded-lg border border-dashed border-cue-400/50 p-3 text-left font-mono text-xs whitespace-pre-wrap text-cue-700">
          {detail}
        </pre>
      )}
    </div>
  );
}

/** The way back to the right home for each area, styled for the tone it sits on. */
export function HomeLink({ href, label, tone = "light" }: { href: string; label: string; tone?: ProblemTone }) {
  return (
    <Link href={href} className={tone === "dark" ? "btn border-white/10 bg-white/[0.04] text-white hover:border-white/20 hover:bg-white/[0.08]" : "btn"}>
      {label}
    </Link>
  );
}

/** A whole page for problems outside any area's frame (the root, the private link pages). */
export function ProblemScreen({ children, logo = true }: { children: React.ReactNode; logo?: boolean }) {
  return (
    <div className="min-h-screen bg-ink-50 px-4 py-6 text-ink-950 sm:px-8">
      {logo && (
        <Link href="/" aria-label="Gigsaw home" className="inline-block">
          <Logo tone="light" size={28} />
        </Link>
      )}
      {children}
    </div>
  );
}

/** For the private links sent to acts, clients and venues: shown when a link is wrong, old or replaced. */
export function LinkMissing() {
  return (
    <ProblemScreen logo={false}>
      <Problem state="silent" label="Link not found" title="This link isn't working">
        It may have expired, or been replaced by a newer one. Ask whoever sent it to you for a fresh link.
      </Problem>
    </ProblemScreen>
  );
}
