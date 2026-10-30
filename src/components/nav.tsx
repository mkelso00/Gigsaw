"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { logout } from "@/actions/auth";
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
      { href: "/enquiries", label: "Enquiries", icon: "inbox" },
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

/** What the count by a menu link means. */
const BADGE_TITLES: Record<string, string> = {
  "/artists": "New acts waiting for approval",
  "/enquiries": "New enquiries from your website",
};

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
    <nav className="motion-slide-in flex gap-1 overflow-x-auto px-3 pb-3 lg:min-h-0 lg:flex-col lg:gap-0.5 lg:overflow-y-auto lg:pb-4">
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
  drawer = false,
}: {
  isAdmin: boolean;
  isOwner: boolean;
  badges?: Record<string, number>;
  business: { name: string; email: string };
  /** The phone menu: always a full list, even in Settings. */
  drawer?: boolean;
}) {
  const path = usePathname();
  if (!drawer && isAdmin && path.startsWith("/settings")) return <SettingsNav business={business} />;
  const sections: { title?: string; links: NavItem[] }[] = [
    ...SECTIONS,
    {
      // In the phone menu these sit at the end; on a computer they're at the bottom of the sidebar.
      links: [
        ...(isAdmin ? [{ href: "/settings", label: "Settings", icon: "settings", mobileOnly: true }] : []),
        { href: "/profile", label: "Profile", icon: "user", mobileOnly: true },
        ...(isOwner ? [{ href: "/owner", label: "Owner area", icon: "owner", mobileOnly: true }] : []),
      ],
    },
  ];
  return (
    <nav className={`${drawer ? "flex" : "hidden lg:flex"} min-h-0 flex-col overflow-y-auto px-3 pb-4`}>
      {sections.map((section, i) => (
        <div key={section.title ?? i} className={`flex flex-col gap-0.5 ${i > 0 ? "mt-5" : ""}`}>
          {section.title && <div className="px-3 pb-1.5 font-mono text-[10px] font-medium tracking-[0.14em] text-ink-500 uppercase">{section.title}</div>}
          {section.links.map((l) => {
            // The most specific link wins, so /reports/venues doesn't also light up Reports.
            const matches = (href: string) => path === href || path.startsWith(`${href}/`);
            const active =
              matches(l.href) && !sections.some((x) => x.links.some((o) => o.href.length > l.href.length && o.href.startsWith(l.href) && matches(o.href)));
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`group relative ${l.mobileOnly && !drawer ? "hidden" : "flex"} items-center gap-3 rounded-lg px-3 py-2 text-sm whitespace-nowrap transition-colors ${
                  active ? "bg-white/[0.08] font-medium text-white" : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
                }`}
              >
                {active && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-volt-400 shadow-[0_0_8px_var(--color-volt-400)]" />}
                <Icon name={l.icon} className={`h-[18px] w-[18px] ${active ? "text-volt-400" : "text-ink-500 group-hover:text-ink-300"}`} />
                {l.label}
                {badges[l.href] ? (
                  <span
                    className="ml-auto rounded-full bg-cue-500 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white"
                    title={BADGE_TITLES[l.href] ?? "Gigs in the next 7 days with no act"}
                  >
                    {badges[l.href]}
                  </span>
                ) : null}
                {l.live && (
                  <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] font-semibold tracking-wider text-cue-400 uppercase">
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cue-400 opacity-75" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cue-400 shadow-[0_0_6px_var(--color-cue-400)]" />
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

/** Phones: a menu button that opens the full menu as a panel over the page. */
export function MobileMenu(props: Parameters<typeof NavLinks>[0] & { logo: React.ReactNode; user: { name: string; email: string } }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  // Close it after moving to another page.
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-white hover:bg-white/[0.06] lg:hidden" aria-label="Open menu" aria-expanded={open}>
        <Icon name="menu" className="h-6 w-6" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button className="absolute inset-0 bg-black/60" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-xs flex-col bg-[#0b0d0f] shadow-2xl">
            <div className="flex items-center justify-between px-5 pt-5 pb-4">
              {props.logo}
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-ink-400 hover:bg-white/[0.06] hover:text-white" aria-label="Close menu">
                <Icon name="close" className="h-5 w-5" />
              </button>
            </div>
            {/* Tapping a link closes the menu straight away. */}
            <div className="flex min-h-0 flex-col" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
              <NavLinks {...props} drawer />
            </div>
            <div className="mt-auto border-t border-white/[0.06] px-5 py-4">
              <div className="truncate text-sm font-medium text-white">{props.user.name}</div>
              <div className="truncate text-xs text-ink-500">{props.user.email}</div>
              <form action={logout} className="mt-3">
                <button className="text-sm text-ink-400 hover:text-white">Sign out</button>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
