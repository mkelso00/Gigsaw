"use client";

import { usePathname } from "next/navigation";

/**
 * Wraps each page so it eases in when you move between pages, instead of just appearing.
 * Settings pages slide in from the side, like opening a drawer; everything else rises gently.
 */
export default function PageMotion({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <div className={path.startsWith("/settings") ? "motion-slide-in" : "motion-page-in"}>{children}</div>;
}
