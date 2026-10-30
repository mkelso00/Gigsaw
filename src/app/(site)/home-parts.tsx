import Link from "next/link";
import { ArrowRight } from "./site-ui";

// Pieces of the home page: the desktop window and phone in the hero, the facts strip, the
// "who it's for" cards and the feature cards. Acts, venues and money in the drawings are made up.

const DESK_ROTA: { venue: string; cells: [string, "booked" | "empty" | "offer"][] }[] = [
  {
    venue: "The Anchor",
    cells: [
      ["Ellie Marsh", "booked"],
      ["Wonderlust", "booked"],
      ["Jo Drummond", "offer"],
    ],
  },
  {
    venue: "Red Lion",
    cells: [
      ["Sam Ortiz Duo", "booked"],
      ["Needs an act", "empty"],
      ["DJ Kestrel", "booked"],
    ],
  },
  {
    venue: "Wharf Bar",
    cells: [
      ["Needs an act", "empty"],
      ["Graham McKee", "booked"],
      ["Velvet Owls", "booked"],
    ],
  },
  {
    venue: "The Crown",
    cells: [
      ["Finn Carter", "booked"],
      ["Jade Duncan", "offer"],
      ["Ellie Marsh", "booked"],
    ],
  },
];

const DESK_CELL = {
  booked: "border-ink-200 bg-white text-ink-900",
  empty: "border-amber-300 border-dashed bg-amber-50 text-amber-800",
  offer: "border-volt-200 bg-volt-100 text-volt-700",
};

/** The agency's screen on a computer: a slice of the dashboard and the rota. */
export function DeskWindow() {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-[0_40px_80px_-40px_rgba(21,24,28,0.45)]">
      <div className="flex items-center gap-2 border-b border-ink-100 bg-ink-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
        <span className="h-2.5 w-2.5 rounded-full bg-ink-300" />
        <span className="ml-3 font-mono text-[11px] text-ink-500">gigsaw.live/rota</span>
      </div>
      <div className="flex">
        <div className="hidden w-14 shrink-0 flex-col items-center gap-3 bg-ink-950 py-4 sm:flex">
          <span className="h-7 w-7 rounded-md bg-volt-400" />
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={`relative h-5 w-5 rounded ${i === 1 ? "bg-white/20" : "bg-white/[0.07]"}`}>
              {i === 1 && <span className="absolute top-0.5 -left-[18px] h-4 w-[3px] rounded-full bg-volt-400 shadow-[0_0_8px_var(--color-volt-400)]" />}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1 p-4 sm:p-5">
          <div className="grid grid-cols-3 gap-2">
            {[
              ["Tonight", "12", "bg-volt-400"],
              ["Arrived", "9", "bg-volt-400"],
              ["Late", "1", "bg-cue-500"],
            ].map(([label, value, led]) => (
              <div key={label} className="rounded-lg border border-ink-200 px-3 py-2.5">
                <div className="flex items-center gap-1.5 font-mono text-[9px] tracking-[0.12em] text-ink-500 uppercase">
                  <span className={`h-1.5 w-1.5 rounded-full ${led}`} />
                  {label}
                </div>
                <div className="mt-1.5 font-mono text-xl font-semibold text-ink-950">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-sm font-bold [font-stretch:125%]">Rota</p>
            <p className="font-mono text-[10px] text-ink-500">WEEK OF 3 NOV</p>
          </div>
          <div className="mt-2.5 grid grid-cols-[minmax(0,0.8fr)_repeat(3,minmax(0,1fr))] gap-1.5 text-[11px]">
            <span />
            {["THU", "FRI", "SAT"].map((d) => (
              <span key={d} className="px-1 font-mono text-[10px] text-ink-400">
                {d}
              </span>
            ))}
            {DESK_ROTA.map((row) => (
              <DeskRow key={row.venue} row={row} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DeskRow({ row }: { row: (typeof DESK_ROTA)[number] }) {
  return (
    <>
      <span className="flex items-center truncate pr-1 font-medium text-ink-600">{row.venue}</span>
      {row.cells.map(([act, kind], i) => (
        <span key={i} className={`truncate rounded-md border px-2 py-2 ${DESK_CELL[kind]}`}>
          {act}
        </span>
      ))}
    </>
  );
}

/** The act's phone: tonight's gig and the arrival buttons. */
export function PhoneSketch() {
  return (
    <div className="w-[210px] rounded-[1.75rem] border border-ink-200 bg-white p-2 shadow-[0_30px_60px_-25px_rgba(21,24,28,0.5)]">
      <div className="rounded-[1.35rem] bg-ink-950 px-4 pt-3 pb-4">
        <div className="flex justify-between font-mono text-[9px] text-ink-400">
          <span>18:18</span>
          <span>GIGSAW</span>
        </div>
        <p className="mt-3 font-mono text-[9px] tracking-[0.12em] text-ink-400 uppercase">Tonight · call 18:30</p>
        <p className="mt-1 text-[15px] leading-tight font-bold text-white [font-stretch:125%]">The Anchor, Leeds</p>
        <p className="mt-0.5 text-[11px] text-ink-400">19:00 to 22:00 · Your fee £150</p>
        <span className="mt-3 flex h-9 items-center justify-center rounded-lg border border-white/10 text-[11px] text-ink-400">I&apos;m on the way</span>
        <span className="mt-1.5 flex h-9 items-center justify-center rounded-lg bg-volt-400 text-[11px] font-semibold text-ink-950">I&apos;ve arrived</span>
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-volt-400/10 px-2.5 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-volt-400 shadow-[0_0_6px_var(--color-volt-400)]" />
          <span className="text-[10px] leading-snug text-volt-200">Arrived 12 min early. Verified at the venue.</span>
        </div>
      </div>
    </div>
  );
}

const FACTS = [
  "Acts accept bookings by link",
  "Live arrivals and late alerts",
  "Weekly bar slots and weddings",
  "Venue statements and invoices",
  "Acts never see your margin",
  "Import from Overture",
  "Free act app",
  "Made in the UK",
];

/** A slow scrolling strip of what Gigsaw does. Two copies so it loops without a gap. */
export function FactsStrip() {
  return (
    <div className="group relative overflow-hidden border-y border-ink-200 bg-white py-4 [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
      <div className="flex w-max animate-[marquee_40s_linear_infinite] gap-10 group-hover:[animation-play-state:paused] motion-reduce:animate-none">
        {[...FACTS, ...FACTS].map((f, i) => (
          <span
            key={i}
            className="flex items-center gap-2.5 font-mono text-[12px] tracking-[0.08em] whitespace-nowrap text-ink-600 uppercase"
            aria-hidden={i >= FACTS.length}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${i % 3 === 2 ? "bg-cue-500" : "bg-volt-400"}`} />
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

const KINDS = [
  {
    label: "CH 01",
    title: "Bar and pub residencies",
    body: "Weekly slots at every venue on one rota. Book the regulars twelve weeks ahead and fill the gaps in minutes.",
    tone: "bg-volt-500 text-ink-950",
    wave: "text-ink-950/15",
  },
  {
    label: "CH 02",
    title: "Weddings and private parties",
    body: "One booking for the couple with every act on it, one invoice, and a planner link for the couple.",
    tone: "bg-cue-500 text-white",
    wave: "text-white/20",
  },
  {
    label: "CH 03",
    title: "Corporate and events",
    body: "Several acts across a day, clear times for everyone, and the client pays one bill with your booking fee on top.",
    tone: "bg-ink-950 text-white",
    wave: "text-volt-400/30",
  },
];

/** Big colour cards, one per kind of work, each with a sound wave drawn behind it. */
export function KindCards() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {KINDS.map((k, n) => (
        <div
          key={k.title}
          data-reveal
          style={{ transitionDelay: `${n * 120}ms` }}
          className={`relative flex min-h-[340px] flex-col overflow-hidden rounded-2xl p-6 sm:p-7 ${k.tone}`}
        >
          <Wave seed={n} className={`absolute inset-x-0 top-10 h-40 w-full ${k.wave}`} />
          <p className="relative font-mono text-[11px] tracking-[0.14em] opacity-80">{k.label}</p>
          <div className="relative mt-auto">
            <h3 className="text-2xl leading-tight font-bold tracking-[-0.01em]">{k.title}</h3>
            <p className="mt-3 text-[15px] leading-relaxed opacity-85">{k.body}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** A row of level bars, different for each card. */
function Wave({ seed, className }: { seed: number; className: string }) {
  const bars = Array.from({ length: 48 }, (_, i) => 12 + Math.abs(Math.sin(i * (0.37 + seed * 0.11)) * 70 + Math.sin(i * 1.7 + seed) * 18));
  return (
    <svg viewBox="0 0 480 160" preserveAspectRatio="none" aria-hidden className={className}>
      {bars.map((h, i) => (
        <rect
          key={i}
          x={i * 10 + 2}
          y={80 - h / 2}
          width="5"
          height={h}
          rx="2.5"
          fill="currentColor"
          className="level-bar"
          style={{ animationDelay: `${-((i * 137 + seed * 51) % 160) / 100}s`, animationDuration: `${1.3 + ((i * 7 + seed) % 9) / 10}s` }}
        />
      ))}
    </svg>
  );
}

/** A feature card: small label, bold title, round arrow, and a drawing of the screen underneath. */
export function FeatureCard({
  label,
  title,
  href,
  children,
  className = "",
  wash = "bg-volt-300",
}: {
  label: string;
  title: string;
  href: string;
  children: React.ReactNode;
  className?: string;
  /** The colour of the glow in the corner. */
  wash?: string;
}) {
  return (
    <Link
      href={href}
      data-reveal
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white transition hover:-translate-y-0.5 hover:shadow-[0_24px_48px_-28px_rgba(21,24,28,0.4)] ${className}`}
    >
      {/* A soft wash of colour in the corner, like light from a desk. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute -right-24 -bottom-24 h-80 w-80 rounded-full opacity-40 blur-3xl transition-opacity group-hover:opacity-70 ${wash}`}
      />
      <div className="relative flex items-start justify-between gap-4 p-6 sm:p-7">
        <div>
          <p className="font-mono text-[11px] tracking-[0.12em] text-ink-500 uppercase">{label}</p>
          <h3 className="mt-2 text-xl leading-snug font-bold tracking-[-0.01em] sm:text-[22px]">{title}</h3>
        </div>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-700 transition group-hover:bg-ink-950 group-hover:text-white">
          <ArrowRight />
        </span>
      </div>
      <div className="relative mt-auto px-6 sm:px-7">{children}</div>
    </Link>
  );
}

/** The money side of one booking, as the agency sees it. */
export function MoneySketch() {
  return (
    <div className="rounded-t-xl border border-b-0 border-ink-200 bg-white p-5">
      <p className="text-sm font-bold [font-stretch:125%]">Fri 14 Nov · The Anchor</p>
      <dl className="mt-4 space-y-2.5 text-sm">
        {[
          ["Venue pays", "£250.00 + VAT"],
          ["Act is paid", "£150.00"],
          ["Booking fee", "£25.00"],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-ink-100 pb-2.5">
            <dt className="text-ink-500">{k}</dt>
            <dd className="font-mono text-ink-950">{v}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 pt-1">
          <dt className="flex items-center gap-2 font-medium">
            <span className="h-1.5 w-1.5 rounded-full bg-volt-400 shadow-[0_0_6px_var(--color-volt-400)]" />
            You make
          </dt>
          <dd className="font-mono text-lg font-semibold text-volt-700">£125.00</dd>
        </div>
      </dl>
    </div>
  );
}

/** Offers going out and coming back, as the agency sees them. */
export function OffersSketch() {
  const rows: [string, string, string, string][] = [
    ["Ellie Marsh", "The Swan · Fri 30 Oct", "Accepted", "bg-volt-100 text-volt-700"],
    ["Sam Ortiz Duo", "Old Bank · Sat 31 Oct", "Waiting", "bg-ink-100 text-ink-600"],
    ["DJ Kestrel", "The Lantern · Sat 31 Oct", "Declined", "bg-cue-100 text-cue-700"],
  ];
  return (
    <div className="rounded-t-xl border border-b-0 border-ink-200 bg-white p-2">
      {rows.map(([act, where, state, tone]) => (
        <div key={act} className="flex items-center justify-between gap-3 rounded-lg px-3 py-3 odd:bg-ink-50">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{act}</span>
            <span className="block truncate text-xs text-ink-500">{where}</span>
          </span>
          <span className={`badge ${tone}`}>{state}</span>
        </div>
      ))}
    </div>
  );
}

/** Tonight's live board, light. */
export function LiveSketch() {
  const rows: [string, string, string][] = [
    ["Ellie Marsh", "The Anchor · arrived 12 min early", "bg-volt-400"],
    ["Sam Ortiz Duo", "Red Lion · here by 18:52", "bg-amber-400"],
    ["DJ Kestrel", "Wharf Bar · late, call was 18:30", "bg-cue-500"],
  ];
  return (
    <div className="rounded-t-xl border border-b-0 border-ink-200 bg-white p-2">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-sm font-bold [font-stretch:125%]">Tonight</span>
        <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-cue-500 uppercase">
          <LevelMeter />
          Live
        </span>
      </div>
      {rows.map(([act, line, led]) => (
        <div key={act} className="flex items-center gap-3 rounded-lg px-3 py-3 odd:bg-ink-50">
          <span className={`h-2 w-2 shrink-0 rounded-full ${led} shadow-[0_0_6px_currentColor]`} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{act}</span>
            <span className="block truncate text-xs text-ink-500">{line}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

/** Slow drifting sound waves behind the hero, in the brand colours. Two copies side by side so the drift loops. */
export function SoundWaves({ className = "" }: { className?: string }) {
  const path = (amp: number, freq: number, phase: number) => {
    let d = "M0 100";
    for (let x = 0; x <= 1200; x += 10)
      d += ` L${x} ${(100 + Math.sin((x / 1200) * Math.PI * 2 * freq + phase) * amp * Math.sin((x / 1200) * Math.PI * freq)).toFixed(1)}`;
    return d;
  };
  const lines: [number, number, number, string, number][] = [
    [70, 4, 0, "var(--color-volt-400)", 0.55],
    [50, 4, 1.2, "var(--color-cue-400)", 0.35],
    [36, 8, 2.1, "var(--color-volt-300)", 0.4],
    [24, 4, 3.3, "var(--color-ink-400)", 0.3],
  ];
  return (
    <div aria-hidden className={`pointer-events-none overflow-hidden ${className}`}>
      <div className="wave-drift flex h-full w-[200%]">
        {[0, 1].map((k) => (
          <svg key={k} viewBox="0 0 1200 200" preserveAspectRatio="none" className="h-full w-1/2">
            {lines.map(([amp, freq, phase, colour, op], i) => (
              <path key={i} d={path(amp, freq, phase)} fill="none" stroke={colour} strokeOpacity={op} strokeWidth={i === 0 ? 2.5 : 1.5} />
            ))}
          </svg>
        ))}
      </div>
    </div>
  );
}

/** A tiny bouncing level meter, used next to "Live". */
export function LevelMeter({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 14" aria-hidden className={`h-3.5 w-5 ${className}`}>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={i * 5 + 0.5}
          y="1"
          width="3"
          height="12"
          rx="1.5"
          fill="currentColor"
          className="level-bar"
          style={{ animationDelay: `${-i * 0.37}s`, animationDuration: `${0.9 + i * 0.17}s` }}
        />
      ))}
    </svg>
  );
}

/** A wedding with several acts on one booking. */
export function WeddingSketch() {
  const rows: [string, string, string][] = [
    ["13:00", "Ceremony singer", "Ellie Marsh"],
    ["15:30", "Drinks reception", "Sam Ortiz Duo"],
    ["19:30", "Evening band", "The Velvet Owls"],
    ["23:00", "DJ until late", "DJ Kestrel"],
  ];
  return (
    <div className="rounded-t-xl border border-b-0 border-ink-200 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold [font-stretch:125%]">Amy and Tom&apos;s wedding</p>
        <span className="badge bg-volt-100 text-volt-700">One invoice</span>
      </div>
      <ol className="mt-4 space-y-2">
        {rows.map(([time, what, act]) => (
          <li key={time} className="flex items-center gap-3 text-sm">
            <span className="w-12 shrink-0 font-mono text-xs text-ink-500">{time}</span>
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cue-400" />
            <span className="min-w-0 truncate">
              <span className="font-medium">{what}</span> <span className="text-ink-500">· {act}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Sixteen steps lighting up in turn, like a drum machine playing a bar. */
export function StepLights({ className = "" }: { className?: string }) {
  // Steps that "hit" in this pattern light brighter, so it reads as a beat rather than a scan.
  const hits = new Set([0, 4, 6, 8, 12, 14]);
  return (
    <div aria-hidden className={`flex gap-1.5 ${className}`}>
      {Array.from({ length: 16 }, (_, i) => (
        <span
          key={i}
          className={`step-light h-2.5 w-2.5 rounded-[3px] ${i % 4 === 0 ? "bg-ink-300" : "bg-ink-200"} ${hits.has(i) ? "step-hit" : ""}`}
          style={{ animationDelay: `${i * 0.2}s`, ["--step-base" as string]: i % 4 === 0 ? "var(--color-ink-300)" : "var(--color-ink-200)" }}
        />
      ))}
    </div>
  );
}
