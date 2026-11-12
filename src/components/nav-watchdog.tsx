"use client";

import { useEffect } from "react";

/**
 * Next 15.5 sometimes fetches the page a link points to but never shows it, so a click on a menu item or tab
 * seems to do nothing. This watches clicks on links within the site: if 5 seconds later the browser is still on
 * the page the click was made from, it opens the link directly. A link that redirects elsewhere still counts as
 * having moved, and a newer click cancels the older check.
 */
export function NavWatchdog() {
  useEffect(() => {
    let latest = 0;
    const onClick = (e: MouseEvent) => {
      // Only clicks Next's <Link> took over (it prevents the browser's own navigation), plain left clicks.
      if (!e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      const from = window.location.pathname + window.location.search;
      if (to.pathname + to.search === from) return; // same page (or just a #section)
      const click = ++latest;
      setTimeout(() => {
        if (click === latest && window.location.pathname + window.location.search === from) window.location.assign(to.href);
      }, 5000);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
