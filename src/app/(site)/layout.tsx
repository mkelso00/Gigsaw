import Link from "next/link";
import { Logo } from "@/components/logo";
import { currentUser, homePath } from "@/lib/auth";
import { MobileMenu } from "./mobile-menu";
import { Reveal } from "./reveal";
import { SiteFooter } from "./footer";
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
          <div className="flex items-center gap-10">
            <Link href="/" aria-label="Gigsaw home" className="rounded-lg focus-visible:ring-2 focus-visible:ring-volt-400 focus-visible:outline-none">
              <Logo tone="light" size={30} />
            </Link>
            <nav className="hidden items-center gap-7 md:flex">
              {NAV.map((l) => (
                <Link key={l.href} href={l.href} className="text-[15px] font-medium text-ink-700 transition-colors hover:text-ink-950">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
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
                <Link href="/signup" className="btn btn-primary">
                  Try it free
                </Link>
              </>
            )}
          </div>
          <MobileMenu links={NAV} accountHref={accountHref} />
        </Container>
      </header>

      <main className="flex-1">{children}</main>
      <Reveal />
      {/* Without JavaScript nothing should stay hidden waiting to fade in. */}
      <noscript>
        <style>{"[data-reveal]{opacity:1!important;transform:none!important}"}</style>
      </noscript>

      <SiteFooter />
    </div>
  );
}
