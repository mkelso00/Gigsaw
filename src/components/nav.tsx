"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";
import { SETTINGS_PAGES } from "@/components/settings-ui";

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

/** In Settings the sidebar becomes the settings menu, like Shopify's admin. */
function SettingsNav({ business }: { business: { name: string; email: string } }) {
  const path = usePathname();
  const [q, setQ] = useState("");
  const pages = SETTINGS_PAGES.filter((p) => !q || `${p.label} ${p.hint}`.toLowerCase().includes(q.toLowerCase()));
  const initials = business.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 3)
    .toUpperCase();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:min-h-0 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:pb-4">
      <Link href="/dashboard" className="flex shrink-0 items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-white hover:bg-white/[0.04]">
        <Icon name="back" className="h-4 w-4 text-ink-400" />
        Settings
      </Link>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search settings"
        aria-label="Search settings"
        className="my-2 hidden w-full rounded-lg border border-white/[0.08] bg-white/[0.06] px-3 py-2 text-sm text-white placeholder:text-ink-500 focus:border-volt-400/50 focus:outline-none lg:block"
      />
      <div className="mb-2 hidden items-center gap-3 rounded-lg px-2 py-2 lg:flex">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-white">{business.name}</div>
          <div className="truncate text-xs text-ink-500">{business.email || "No business email yet"}</div>
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-volt-400 text-[10px] font-bold text-ink-950">{initials}</span>
      </div>
      {pages.map((p) => {
        const active = path === p.href || path.startsWith(`${p.href}/`);
        return (
          <Link
            key={p.href}
            href={p.href}
            className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
              active ? "bg-white/[0.08] font-medium text-white" : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            <Icon name={p.icon} className={`h-[18px] w-[18px] ${active ? "text-volt-400" : "text-ink-500"}`} />
            {p.label}
          </Link>
        );
      })}
      {!pages.length && <p className="px-3 py-2 text-sm text-ink-500">Nothing matches.</p>}
    </nav>
  );
}

export function NavLinks({
  isAdmin,
  isOwner,
  badges = {},
  business,
}: {
  isAdmin: boolean;
  isOwner: boolean;
  badges?: Record<string, number>;
  business: { name: string; email: string };
}) {
  const path = usePathname();
  if (isAdmin && path.startsWith("/settings")) return <SettingsNav business={business} />;
  const sections: { title?: string; links: NavItem[] }[] = [
    ...SECTIONS,
    {
      // On phones the sidebar is a scrolling strip, so these sit at its end; on a computer they're at the bottom.
      links: [
        ...(isAdmin ? [{ href: "/settings", label: "Settings", icon: "settings", mobileOnly: true }] : []),
        { href: "/profile", label: "Profile", icon: "user", mobileOnly: true },
        ...(isOwner ? [{ href: "/owner", label: "Owner area", icon: "owner", mobileOnly: true }] : []),
      ],
    },
  ];
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:min-h-0 lg:flex-col lg:gap-0 lg:overflow-y-auto lg:pb-4">
      {sections.map((section, i) => (
        <div key={section.title ?? i} className={`flex gap-1 lg:flex-col lg:gap-0.5 ${i > 0 ? "lg:mt-5" : ""}`}>
          {section.title && <div className="hidden px-3 pb-1 text-xs font-medium text-ink-500 lg:block">{section.title}</div>}
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
