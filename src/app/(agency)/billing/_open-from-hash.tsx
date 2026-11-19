"use client";

import { useEffect } from "react";

/**
 * Keeps an opened bill open: opening one puts its id in the address (#bill-…), and the page opens the bill
 * named there when it loads, so it stays open after a save that reloads the page, and a link can open one.
 */
export function OpenFromHash() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const el = id ? document.getElementById(id) : null;
      if (el instanceof HTMLDetailsElement) el.open = true;
    };
    const toggled = (e: Event) => {
      const el = e.target;
      if (!(el instanceof HTMLDetailsElement) || !el.dataset.bill) return;
      const url = new URL(window.location.href);
      if (el.open) url.hash = el.id;
      else if (url.hash === `#${el.id}`) url.hash = "";
      window.history.replaceState(window.history.state, "", url);
    };
    open();
    window.addEventListener("hashchange", open);
    document.addEventListener("toggle", toggled, true);
    return () => {
      window.removeEventListener("hashchange", open);
      document.removeEventListener("toggle", toggled, true);
    };
  }, []);
  return null;
}
