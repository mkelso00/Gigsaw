"use client";

import { useEffect, useState } from "react";

/**
 * Inside another website's frame, tell that page how tall the form is, so the frame can grow to fit
 * (the embed code listens for this). `sent` asks it to scroll the thank-you into view.
 */
export function FrameHeight({ sent = false }: { sent?: boolean }) {
  useEffect(() => {
    if (window.parent === window) return;
    // The page's own content, not the window: the window is as tall as the frame, so it could never shrink.
    const root = document.querySelector<HTMLElement>("[data-enquiry-root]");
    if (!root) return;
    let last = 0;
    const post = () => {
      const height = Math.ceil(root.getBoundingClientRect().height);
      if (height === last) return;
      last = height;
      window.parent.postMessage({ type: "gigsaw-enquiry", height, sent }, "*");
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(root);
    window.addEventListener("load", post);
    return () => {
      ro.disconnect();
      window.removeEventListener("load", post);
    };
  }, [sent]);
  return null;
}

/** Tick the acts you like. With a long list, a search box narrows it (ticked ones stay ticked and are still sent). */
export function ActPicker({ acts }: { acts: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const find = q.trim().toLowerCase();
  return (
    <div>
      {acts.length > 8 && (
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search our acts"
          aria-label="Search our acts"
          className="input mb-3"
          // Enter here shouldn't send the form.
          onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
        />
      )}
      <div className="flex max-h-72 flex-wrap gap-2 overflow-y-auto p-0.5">
        {acts.map((a) => {
          const on = picked.has(a.id);
          const shown = !find || on || a.name.toLowerCase().includes(find);
          return (
            <label
              key={a.id}
              className={`${shown ? "inline-flex" : "hidden"} min-h-11 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors select-none ${
                on ? "border-ink-950 bg-ink-950 text-white" : "border-ink-200 bg-white text-ink-800 hover:border-ink-400"
              } has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-volt-300/60`}
            >
              <input
                type="checkbox"
                name="acts"
                value={a.id}
                checked={on}
                onChange={() =>
                  setPicked((p) => {
                    const next = new Set(p);
                    if (next.has(a.id)) next.delete(a.id);
                    else next.add(a.id);
                    return next;
                  })
                }
                className="sr-only"
              />
              {on && <span aria-hidden>✓</span>}
              {a.name}
            </label>
          );
        })}
        {find && !acts.some((a) => a.name.toLowerCase().includes(find)) && <p className="px-1 py-2 text-sm text-ink-500">No act by that name.</p>}
      </div>
    </div>
  );
}
