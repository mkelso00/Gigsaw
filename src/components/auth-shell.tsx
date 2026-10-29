import { Logo } from "@/components/logo";

/** Split-screen layout for sign in, setup and password pages. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden bg-ink-950 p-12 text-white lg:flex lg:flex-col">
        <Logo size={32} />
        <div className="my-auto max-w-lg">
          <h2 className="text-[56px] leading-[0.95] font-semibold tracking-[-0.04em]">
            Every gig.
            <br />
            <span className="text-volt-400">On time.</span>
          </h2>
          <p className="mt-6 max-w-md text-lg text-ink-400">
            Bookings, contracts, money and tours for music agencies, with live arrival check-ins from every artist.
          </p>
          <div className="mt-12 max-w-sm space-y-2.5">
            {[
              ["Maya Okafor Trio", "Arrived 12 min early", "bg-emerald-400"],
              ["The Velvet Owls", "On the way · ETA 18:40", "bg-volt-400"],
              ["DJ Kestrel", "Call time was 18:00", "bg-rose-500"],
            ].map(([name, status, dot]) => (
              <div key={name} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 backdrop-blur">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                <span className="text-sm font-medium">{name}</span>
                <span className="ml-auto text-xs text-ink-400">{status}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-xs text-ink-500">© Gigsaw</p>
        <div className="pointer-events-none absolute -right-40 -bottom-40 h-[480px] w-[480px] rounded-full bg-volt-400/10 blur-3xl" />
      </section>
      <section className="flex items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 lg:hidden">
            <Logo tone="light" size={32} />
          </div>
          <h1 className="text-[28px] font-semibold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="mt-2 mb-8 text-[15px] text-ink-500">{subtitle}</p>}
          {!subtitle && <div className="mb-8" />}
          {children}
        </div>
      </section>
    </main>
  );
}
