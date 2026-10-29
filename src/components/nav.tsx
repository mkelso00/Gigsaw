"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/arrivals", label: "Arrivals" },
  { href: "/calendar", label: "Calendar" },
  { href: "/bookings", label: "Bookings" },
  { href: "/artists", label: "Artists" },
  { href: "/contacts", label: "Contacts" },
  { href: "/venues", label: "Venues" },
  { href: "/reports", label: "Reports" },
];

export function NavLinks({ isAdmin, isOwner }: { isAdmin: boolean; isOwner: boolean }) {
  const path = usePathname();
  const links = [...LINKS, { href: "/settings", label: isAdmin ? "Settings" : "My account" }, ...(isOwner ? [{ href: "/owner", label: "Owner area →" }] : [])];
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0">
      {links.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition ${
              active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            {l.label}
            {l.href === "/arrivals" && <span className="ml-2 rounded bg-brand-600 px-1.5 py-0.5 text-[10px] font-semibold text-white">LIVE</span>}
          </Link>
        );
      })}
    </nav>
  );
}
