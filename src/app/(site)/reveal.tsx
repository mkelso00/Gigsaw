"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

/** Fades in anything marked data-reveal once it scrolls into view. One watcher for the whole page. */
export function Reveal() {
  const path = usePathname();
  useEffect(() => {
    const items = document.querySelectorAll<HTMLElement>("[data-reveal]:not([data-reveal='shown'])");
    if (!("IntersectionObserver" in window)) {
      items.forEach((el) => (el.dataset.reveal = "shown"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          (e.target as HTMLElement).dataset.reveal = "shown";
          io.unobserve(e.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    items.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [path]);
  return null;
}
