"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    /** Changes every time the server sends a fresh copy of the page and it's shown. */
    __gigsawRendered?: string;
  }
}

/**
 * Marks each fresh render from the server. After a save, the forms (useActionRunner in forms.tsx) check this
 * changed: Next 15.5 sometimes receives the updated page but never shows it, and then they reload instead.
 */
/**
 * Asks the server for a fresh copy of the page and, if none has been shown 3 seconds later, reloads it. Only
 * where the page has a RenderStamp; elsewhere it's a plain refresh.
 */
export function refreshAndWatch(router: { refresh: () => void }) {
  const before = window.__gigsawRendered;
  router.refresh();
  if (before === undefined || before.startsWith("left ")) return;
  setTimeout(() => {
    if (window.__gigsawRendered === before) window.location.reload();
  }, 3000);
}

export function RenderStamp({ at }: { at: string }) {
  useEffect(() => {
    window.__gigsawRendered = at;
    // Leaving for a page without a stamp (e.g. signing out) counts as something new being shown.
    return () => {
      window.__gigsawRendered = `left ${at}`;
    };
  }, [at]);
  return null;
}
