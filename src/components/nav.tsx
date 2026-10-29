"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";

type NavItem = { href: string; label: string; icon: string; live?: boolean; mobileOnly?: boolean };

// The menu, in sections. On phones it becomes one scrolling strip and the headings are hidden.
const SECTIONS: { title?: string; links: NavItem[] }[] = [
  {
    links: [
      { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
      { href: "/arrivals", label: "Arrivals", icon: "arrivals", live: true },
    ],
  },
  {
    title: "Bookings",
    links: [
      { href: "/calendar", label: "Calendar", icon: "calendar" },
      { href: "/rota", label: "Rota", icon: "rota" },
      { href: "/bookings", label: "All bookings", icon: "bookings" },
      { href: "/events", label: "Weddings & events", icon: "heart" },
    ],
  },
  {
    title: "Roster",
    links: [
      { href: "/artists", label: "Acts", icon: "artists" },
      { href: "/people", label: "People", icon: "contacts" },
    ],
  },
  {
    title: "Clients",
    links: [
      { href: "/venues", label: "Venues", icon: "venues" },
      { href: "/contacts", label: "Companies & customers", icon: "company" },
    ],
  },
  {
    title: "Money",
    links: [
      { href: "/payments", label: "Payments", icon: "payments" },
      { href: "/reports", label: "Reports", icon: "reports" },
      { href: "/reports/venues", label: "Venue statements", icon: "billing" },
    ],
  },
];

export function NavLinks({ isAdmin, isOwner, badges = {} }: { isAdmin: boolean; isOwner: boolean; badges?: Record<string, number> }) {
  const path = usePathname();
  const sections: { title?: string; links: NavItem[] }[] = [
    ...SECTIONS,
    {
      title: "Admin",
      links: [
        { href: "/settings", label: isAdmin ? "Settings" : "My account", icon: "settings" },
        // On phones the sidebar is a scrolling strip, so the owner link sits at its end.
        ...(isOwner ? [{ href: "/owner", label: "Owner area", icon: "owner", mobileOnly: true }] : []),
      ],
    },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:min-h-0 lg:flex-col lg:gap-0 lg:overflow-y-auto lg:pb-4">
      {sections.map((section, i) => (
        <div key={section.title ?? i} className={`flex gap-1 lg:flex-col lg:gap-0.5 ${i > 0 ? "lg:mt-5" : ""}`}>
          {section.title && <div className="hidden px-3 pb-1.5 text-[11px] font-medium tracking-wider text-ink-500 uppercase lg:block">{section.title}</div>}
          {section.links.map((l) => {
            // The most specific link wins, so /reports/venues doesn't also light up Reports.
            const matches = (href: string) => path === href || path.startsWith(`${href}/`);
            const active =
              matches(l.href) && !sections.some((x) => x.links.some((o) => o.href.length > l.href.length && o.href.startsWith(l.href) && matches(o.href)));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`group relative ${l.mobileOnly ? "flex lg:hidden" : "flex"} items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  active ? "bg-white/[0.08] font-medium text-white" : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {active && <span className="absolute top-2 bottom-2 left-0 hidden w-[3px] rounded-full bg-volt-400 lg:block" />}
                <Icon name={l.icon} className={`h-[18px] w-[18px] ${active ? "text-volt-400" : "text-ink-500 group-hover:text-ink-300"}`} />
                {l.label}
                {badges[l.href] ? (
                  <span
                    className="ml-auto rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-ink-950"
                    title={l.href === "/artists" ? "New acts waiting for approval" : "Gigs in the next 7 days with no act"}
                  >
                    {badges[l.href]}
                  </span>
                ) : null}
                {l.live && (
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
        </div>
      ))}
    </nav>
  );
}
