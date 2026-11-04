"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Eases each page in when you move between pages: Settings slides in from the side like a drawer,
 * everything else rises gently. It replays an animation on the same element rather than
 * remounting the page (which a template.tsx does), because remounting could swallow the redirect
 * after a form saves and leave its button stuck on "Saving…".
 */
export function PageMotion({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    // The first page load already has its own fade; only animate later moves.
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !el.animate) return;
    const settings = path.startsWith("/settings");
    el.animate(
      settings
        ? [
            { opacity: 0, transform: "translateX(28px)" },
            { opacity: 1, transform: "none" },
          ]
        : [
            { opacity: 0, transform: "translateY(8px)" },
            { opacity: 1, transform: "none" },
          ],
      { duration: settings ? 420 : 380, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
  }, [path]);
  return <div ref={ref}>{children}</div>;
}
