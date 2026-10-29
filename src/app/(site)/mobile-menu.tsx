"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** The header's menu on phones: a button that drops down the same links as the desktop header. */
export function MobileMenu({ links, accountHref }: { links: { href: string; label: string }[]; accountHref: string | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // The layout stays mounted between pages, so close the menu once a link has been followed.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="site-menu"
        aria-label={open ? "Close menu" : "Open menu"}
        className="-mr-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-950 hover:bg-ink-100 focus-visible:ring-2 focus-visible:ring-volt-400 focus-visible:outline-none"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden className="h-6 w-6">
          {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
      </button>
      {open && (
        <div id="site-menu" className="absolute inset-x-0 top-full border-b border-ink-200 bg-white shadow-[0_24px_40px_-24px_rgba(13,13,12,0.25)]">
          <nav className="flex flex-col px-4 pt-2 pb-5">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={pathname === l.href ? "page" : undefined}
                className="border-b border-ink-100 py-4 text-lg font-medium text-ink-950"
              >
                {l.label}
              </Link>
            ))}
            {accountHref ? (
              <Link href={accountHref} className="btn btn-primary mt-5 h-12 text-base">
                Go to Gigsaw
              </Link>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className="border-b border-ink-100 py-4 text-lg font-medium text-ink-950">
                  Sign in
                </Link>
                <Link href="/signup" className="btn btn-volt mt-5 h-12 text-base">
                  Try it free
                </Link>
              </>
            )}
          </nav>
        </div>
      )}
    </div>
  );
}
