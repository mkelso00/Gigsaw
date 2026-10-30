"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/icons";

const LINKS = [
  { href: "/owner", label: "Businesses", icon: "company" },
  { href: "/owner/billing", label: "Billing", icon: "billing" },
  { href: "/owner/plans", label: "Plans", icon: "plans" },
  { href: "/owner/discounts", label: "Discount codes", icon: "tag" },
  { href: "/owner/stripe", label: "Stripe", icon: "payments" },
  { href: "/owner/messages", label: "Outbox", icon: "mail" },
];

/** The Owner area's menu, styled like the main app's sidebar (a strip that scrolls on phones). */
export function OwnerNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:gap-px lg:pb-0">
      <div className="hidden px-3 pb-1.5 font-mono text-[10px] font-medium tracking-[0.14em] text-ink-500 uppercase lg:block">Owner</div>
      {LINKS.map((l) => {
        const active = l.href === "/owner" ? path === "/owner" || path.startsWith("/owner/businesses") : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`relative flex shrink-0 items-center gap-3 rounded-lg px-3 py-[7px] text-sm whitespace-nowrap transition-colors ${
              active ? "bg-white/[0.08] font-medium text-white" : "text-ink-400 hover:bg-white/[0.04] hover:text-white"
            }`}
          >
            {active && (
              <span className="absolute top-2 bottom-2 left-0 hidden w-[3px] rounded-full bg-volt-400 shadow-[0_0_8px_var(--color-volt-400)] lg:block" />
            )}
            <Icon name={l.icon} className={`h-[18px] w-[18px] ${active ? "text-volt-400" : "text-ink-500"}`} />
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
