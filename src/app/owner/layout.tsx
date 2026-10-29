import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/actions/auth";
import { Logo } from "@/components/logo";
import { requireOwner } from "@/lib/auth";

export const metadata: Metadata = { title: { default: "Owner", template: "%s · Gigsaw owner" } };

const LINKS = [
  ["/owner", "Businesses"],
  ["/owner/billing", "Billing"],
  ["/owner/messages", "Outbox"],
];

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOwner();
  return (
    <div className="min-h-screen">
      <header className="no-print bg-ink-950">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-4 sm:px-8">
          <Link href="/owner">
            <Logo sub="Owner area" />
          </Link>
          <nav className="flex gap-1 text-sm">
            {LINKS.map(([href, label]) => (
              <Link key={href} href={href} className="rounded-lg px-3 py-1.5 text-ink-300 hover:bg-white/[0.06] hover:text-white">
                {label}
              </Link>
            ))}
            {user.agencyId && (
              <Link href="/dashboard" className="rounded-lg px-3 py-1.5 text-volt-400 hover:bg-white/[0.06]">
                My business →
              </Link>
            )}
          </nav>
          <form action={logout} className="ml-auto">
            <button className="text-xs text-ink-400 hover:text-white">Sign out ({user.name.split(" ")[0]})</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">{children}</main>
    </div>
  );
}
