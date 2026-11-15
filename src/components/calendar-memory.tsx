"use client";

import { useEffect } from "react";

/**
 * Saves where you are on the calendar (worked out on the server, see lib/calendar-memory.ts), so a bare
 * /calendar shows this place next time. Written from the browser because a page can't set cookies while
 * it renders. `address` is set when the server drew a remembered place for a bare /calendar: it goes into
 * the address bar without reloading, so a refresh, a shared link or the back button match what's shown.
 */
export function RememberCalendar({ name, value, days, address }: { name: string; value: string; days: number; address?: string }) {
  useEffect(() => {
    document.cookie = `${name}=${encodeURIComponent(value)}; path=/calendar; max-age=${days * 24 * 3600}; samesite=lax`;
  }, [name, value, days]);
  useEffect(() => {
    if (address && window.location.pathname === "/calendar" && !window.location.search) window.history.replaceState(null, "", address);
  }, [address]);
  return null;
}
