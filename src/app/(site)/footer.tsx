import Link from "next/link";
import { Logo } from "@/components/logo";
import { StepLights } from "./home-parts";
import { Container } from "./site-ui";

// The site footer, laid out like the end of a mixing desk: each group of links is a channel
// strip with its own label, level meter and fader, the master channel carries the brand, and a
// huge wide wordmark sits along the bottom edge like the name on the front of the desk.

const CHANNELS: { label: string; title: string; level: number; links: [string, string][] }[] = [
  {
    label: "CH 01",
    title: "Product",
    level: 0.72,
    links: [
      ["/features", "Features"],
      ["/pricing", "Pricing"],
      ["/features#arrivals", "Live arrivals"],
      ["/features#imports", "Moving from Overture"],
    ],
  },
  {
    label: "CH 02",
    title: "Account",
    level: 0.48,
    links: [
      ["/signup", "Try it free"],
      ["/login", "Sign in"],
      ["/forgot-password", "Forgotten password"],
    ],
  },
  {
    label: "CH 03",
    title: "Legal",
    level: 0.3,
    links: [
      ["/privacy", "Privacy"],
      ["/terms", "Terms"],
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-ink-950 text-ink-300">
      <Container className="pt-16 sm:pt-20">
        {/* The sign-off line. */}
        <div className="flex flex-col gap-8 border-b border-white/10 pb-12 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="font-mono text-[11px] tracking-[0.16em] text-volt-400 uppercase">Last orders</p>
            <p className="mt-4 max-w-xl text-3xl leading-[1.08] font-bold tracking-[-0.02em] text-white [font-stretch:125%] sm:text-[40px]">
              Book it. Play it. <span className="text-ink-500">Get paid.</span>
            </p>
          </div>
          <StepLights className="[--color-ink-200:#2e3339] [--color-ink-300:#444a52]" />
        </div>

        {/* The channel strips, then the master channel with the brand. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden border-x border-white/10 bg-white/10 sm:grid-cols-4">
          {CHANNELS.map((c, n) => (
            <Strip key={c.title} label={c.label} level={c.level} seed={n} wide={n === CHANNELS.length - 1}>
              <p className="text-sm font-semibold text-white">{c.title}</p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {c.links.map(([href, label]) => (
                  <li key={href}>
                    <Link href={href} className="transition-colors hover:text-volt-300">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </Strip>
          ))}
          <Strip label="MASTER" level={0.86} seed={7} master>
            <Logo size={28} />
            <p className="mt-4 text-sm leading-relaxed text-ink-400">
              Booking software for music agencies. Weekly slots, weddings and events, with live arrivals.
            </p>
          </Strip>
        </div>

        <div className="flex flex-col gap-2 border-t border-white/10 py-6 font-mono text-[11px] tracking-[0.12em] text-ink-500 uppercase sm:flex-row sm:justify-between">
          <p>© {new Date().getFullYear()} Gigsaw · Made in the UK</p>
          <p className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-volt-400 shadow-[0_0_6px_var(--color-volt-400)]" />
            gigsaw.live · All systems go
          </p>
        </div>
      </Container>

      {/* The name along the front of the desk, cut off by the bottom edge. */}
      <p
        aria-hidden
        className="pointer-events-none -mt-4 -mb-[0.3em] text-center text-[21vw] leading-none font-bold tracking-[-0.04em] text-transparent select-none [font-stretch:125%] [-webkit-text-stroke:1px_rgba(95,219,193,0.5)]"
      >
        gigsaw
      </p>
    </footer>
  );
}

/** One channel strip: a label at the top, its content, and a level meter and fader along the bottom. */
function Strip({
  label,
  level,
  seed,
  master = false,
  wide = false,
  children,
}: {
  label: string;
  level: number;
  seed: number;
  master?: boolean;
  /** Takes the full width on a phone, so two-to-a-row strips never leave a gap. */
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`flex min-h-[230px] flex-col bg-ink-950 p-5 sm:min-h-[300px] sm:p-6 ${master || wide ? "col-span-2 sm:col-span-1" : ""}`}>
      <p className={`font-mono text-[10px] tracking-[0.16em] ${master ? "text-cue-400" : "text-ink-500"}`}>{label}</p>
      <div className="mt-5 flex-1">{children}</div>
      <div className="mt-8 flex h-20 items-end gap-3" aria-hidden>
        {/* Level meter: a stack of small lights, lit up to this channel's level and gently moving. */}
        <div className="flex h-full flex-col-reverse gap-[3px]">
          {Array.from({ length: 10 }, (_, i) => (
            <span
              key={i}
              className={`h-[5px] w-3 rounded-[1px] ${i / 10 < level ? (i >= 8 ? "bg-cue-500" : "bg-volt-400") : "bg-white/[0.06]"} ${i / 10 < level && i >= Math.floor(level * 10) - 2 ? "meter-top" : ""}`}
              style={{ animationDelay: `${-((seed * 0.37 + i * 0.13) % 1.5)}s` }}
            />
          ))}
        </div>
        {/* Fader: a track with a cap sitting at the channel's level. */}
        <div className="relative h-full w-6">
          <span className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded bg-white/10" />
          <span
            className={`absolute left-0 h-3 w-6 rounded-[3px] border ${master ? "border-cue-400/60 bg-cue-500/80" : "border-white/20 bg-ink-700"} shadow-[0_2px_6px_rgba(0,0,0,0.5)]`}
            style={{ bottom: `calc(${level * 100}% - 6px)` }}
          >
            <span className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 bg-white/60" />
          </span>
        </div>
      </div>
    </div>
  );
}
