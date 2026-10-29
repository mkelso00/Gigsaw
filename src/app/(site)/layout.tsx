import Link from "next/link";
import { Logo } from "@/components/logo";
import { currentUser, homePath } from "@/lib/auth";
import { MobileMenu } from "./mobile-menu";
import { Container } from "./site-ui";

const NAV = [
  { href: "/features", label: "Features" },
  { href: "/pricing", label: "Pricing" },
];

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  // The public pages must still load if the database is unreachable, so treat that as signed out.
  const user = await currentUser().catch(() => null);
  const accountHref = user ? homePath(user) : null;

  return (
    <div className="flex min-h-screen flex-col bg-white text-ink-950">
      <header className="sticky top-0 z-40 border-b border-ink-200/70 bg-white/90 backdrop-blur-md">
        <Container className="relative flex h-16 items-center justify-between gap-6">
          <Link href="/" aria-label="Gigsaw home" className="rounded-lg focus-visible:ring-2 focus-visible:ring-volt-400 focus-visible:outline-none">
            <Logo tone="light" size={30} />
          </Link>
          <nav className="hidden items-center gap-8 md:flex">
            {NAV.map((l) => (
              <Link key={l.href} href={l.href} className="text-[15px] font-medium text-ink-700 transition-colors hover:text-ink-950">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="hidden items-center gap-5 md:flex">
            {accountHref ? (
              <Link href={accountHref} className="btn btn-primary">
                Go to Gigsaw
              </Link>
            ) : (
              <>
                <Link href="/login" className="text-[15px] font-medium text-ink-700 transition-colors hover:text-ink-950">
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn-volt">
                  Try it free
                </Link>
              </>
            )}
          </div>
          <MobileMenu links={NAV} accountHref={accountHref} />
        </Container>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="bg-ink-950 text-ink-300">
        <Container className="py-16">
          <div className="grid grid-cols-2 gap-x-8 gap-y-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
            <div className="col-span-2 max-w-xs md:col-span-1">
              <Logo size={30} />
              <p className="mt-5 text-sm leading-relaxed text-ink-400">
                Booking software for music agencies: weekly bar slots, weddings and private events, with live arrivals from every act.
              </p>
            </div>
            <FooterColumn
              title="Product"
              links={[
                ["/features", "Features"],
                ["/pricing", "Pricing"],
                ["/features#arrivals", "Arrivals"],
                ["/features#imports", "Moving from Overture"],
              ]}
            />
            <FooterColumn
              title="Account"
              links={[
                ["/signup", "Try it free"],
                ["/login", "Sign in"],
                ["/forgot-password", "Forgotten password"],
              ]}
            />
            <FooterColumn
              title="Legal"
              links={[
                ["/privacy", "Privacy"],
                ["/terms", "Terms"],
              ]}
            />
          </div>
          <div className="mt-14 flex flex-col gap-2 border-t border-white/10 pt-6 text-sm text-ink-500 sm:flex-row sm:justify-between">
            <p>© {new Date().getFullYear()} Gigsaw. Made in the UK.</p>
            <p>gigsaw.live</p>
          </div>
        </Container>
      </footer>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-sm font-semibold text-white">{title}</p>
      <ul className="mt-4 space-y-3 text-sm">
        {links.map(([href, label]) => (
          <li key={href}>
            <Link href={href} className="transition-colors hover:text-volt-300">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
