"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";

const LINKS = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/arrivals", label: "Arrivals", icon: "arrivals", live: true },
  { href: "/rota", label: "Rota", icon: "rota" },
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/bookings", label: "Bookings", icon: "bookings" },
  { href: "/artists", label: "Artists", icon: "artists" },
  { href: "/contacts", label: "Contacts", icon: "contacts" },
  { href: "/venues", label: "Venues", icon: "venues" },
  { href: "/reports", label: "Reports", icon: "reports" },
];

export function NavLinks({ isAdmin, isOwner }: { isAdmin: boolean; isOwner: boolean }) {
  const path = usePathname();
  const links = [
    ...LINKS,
    { href: "/settings", label: isAdmin ? "Settings" : "My account", icon: "settings" },
    ...(isOwner ? [{ href: "/owner", label: "Owner area", icon: "owner" }] : []),
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:pb-0">
      {links.map((l) => {
        const active = path === l.href || path.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              active ? "bg-white/[0.08] font-medium text-white" : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            {active && <span className="absolute top-2 bottom-2 left-0 hidden w-[3px] rounded-full bg-volt-400 lg:block" />}
            <Icon name={l.icon} className={`h-[18px] w-[18px] ${active ? "text-volt-400" : "text-ink-500 group-hover:text-ink-300"}`} />
            {l.label}
            {"live" in l && l.live && (
              <span className="ml-auto flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-volt-400 uppercase">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-volt-400 opacity-75" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-volt-400" />
                </span>
                Live
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
