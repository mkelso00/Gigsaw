import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/actions/auth";
import { Icon } from "@/components/icons";
import { Logo } from "@/components/logo";
import { requireOwner } from "@/lib/auth";
import { OwnerNav } from "./owner-nav";

export const metadata: Metadata = { title: { default: "Owner", template: "%s · Gigsaw owner" } };

// The Owner area wears the same frame as the main app: a dark sidebar and the page in a light panel.
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const user = await requireOwner();
  return (
    <div className="min-h-screen bg-[#0b0d0f] lg:flex">
      <aside className="no-print bg-[#0b0d0f] lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-60 lg:shrink-0 lg:flex-col">
        <div className="px-5 pt-5 pb-4">
          <Link href="/owner">
            <Logo sub="Owner area" />
          </Link>
        </div>
        <OwnerNav />
        <div className="mt-auto hidden space-y-1 p-3 lg:block">
          {user.agencyId && (
            <Link
              href="/dashboard"
              className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-ink-400 transition-colors hover:bg-white/[0.04] hover:text-white"
            >
              <Icon name="back" className="h-[18px] w-[18px] text-volt-400" />
              Back to my business
            </Link>
          )}
          <form action={logout}>
            <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-ink-400 hover:bg-white/[0.04] hover:text-white">
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded bg-ink-800 text-[9px] font-semibold text-volt-300">
                {user.name.slice(0, 1).toUpperCase()}
              </span>
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1 lg:py-2 lg:pr-2">
        <main className="min-h-screen overflow-x-clip bg-ink-50 px-4 py-6 sm:px-8 lg:min-h-[calc(100vh-1rem)] lg:rounded-2xl lg:px-10 lg:py-10">
          <div className="motion-page-in mx-auto max-w-[1100px]">{children}</div>
          {user.agencyId && (
            <Link href="/dashboard" className="mt-10 block text-center text-sm text-ink-500 lg:hidden">
              ← Back to my business
            </Link>
          )}
        </main>
      </div>
    </div>
  );
}
