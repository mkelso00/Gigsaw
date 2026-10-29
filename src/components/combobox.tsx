"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type ComboOption = { id: string; name: string; /** A second line to tell similar names apart, e.g. a venue's town. */ detail?: string };

// Lower case without accents, so "cafe" finds "Café".
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Only this many are drawn at once; typing narrows the rest down.
const MAX_SHOWN = 80;

/** Options matching every word typed, best first: names starting with it, then a word starting with it, then anywhere. */
export function filterOptions(options: ComboOption[], query: string): ComboOption[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  const scored: [ComboOption, number][] = [];
  for (const o of options) {
    const name = fold(o.name);
    const all = `${name} ${fold(o.detail ?? "")}`;
    if (!words.every((w) => all.includes(w))) continue;
    const first = words[0];
    const score = name.startsWith(first) ? 0 : new RegExp(`(^|[^a-z0-9])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(name) ? 1 : 2;
    scored.push([o, score]);
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([o]) => o);
}

/**
 * A type-to-search picker that works like a <select>: the chosen id goes in a hidden input
 * called `name`, so server actions read it as before. Arrow keys and Enter (or Tab) to pick,
 * Escape to close, × to clear. `emptyLabel` adds a first choice meaning "none" (value "").
 */
export function Combobox({
  name,
  options,
  defaultValue = "",
  emptyLabel,
  placeholder = "Type to search",
  id,
  inputRef,
  onChange,
  required,
  "aria-describedby": describedBy,
}: {
  name: string;
  options: ComboOption[];
  defaultValue?: string;
  emptyLabel?: string;
  placeholder?: string;
  id?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  onChange?: (id: string) => void;
  required?: boolean;
  "aria-describedby"?: string;
}) {
  const auto = useId();
  const inputId = id ?? `${auto}-input`;
  const listId = `${auto}-list`;
  const byId = useMemo(() => new Map(options.map((o) => [o.id, o])), [options]);
  const [value, setValue] = useState(defaultValue && byId.has(defaultValue) ? defaultValue : "");
  const [query, setQuery] = useState<string | null>(null); // null: not typing, show the chosen name
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ownRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);

  const chosen = value ? byId.get(value) : undefined;
  const typed = query ?? "";
  const matches = useMemo(() => filterOptions(options, typed), [options, typed]);
  // The "none" choice shows while the box is empty, so it's one keypress away.
  const showEmpty = !!emptyLabel && !typed.trim();
  const items: (ComboOption | null)[] = [...(showEmpty ? [null] : []), ...matches.slice(0, MAX_SHOWN)];
  const hidden = matches.length - Math.min(matches.length, MAX_SHOWN);

  const pick = (o: ComboOption | null) => {
    const next = o?.id ?? "";
    setValue(next);
    setQuery(null);
    setOpen(false);
    if (next !== value) onChange?.(next);
  };

  // Put the picker back to its starting choice when the form is reset (e.g. after a save).
  useEffect(() => {
    const form = hiddenRef.current?.form;
    if (!form) return;
    const onReset = () => {
      const next = defaultValue && byId.has(defaultValue) ? defaultValue : "";
      setValue(next);
      setQuery(null);
      setOpen(false);
      onChange?.(next);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue, byId, onChange]);

  // Keep the highlighted option in view while arrowing through a long list.
  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const setRefs = (el: HTMLInputElement | null) => {
    ownRef.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };

  const optionId = (i: number) => `${auto}-opt-${i}`;
  const display = query ?? chosen?.name ?? "";

  return (
    <div className="relative">
      <input ref={hiddenRef} type="hidden" name={name} value={value} />
      <input
        ref={setRefs}
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && items.length ? optionId(active) : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        spellCheck={false}
        required={required && !value}
        value={display}
        placeholder={chosen ? undefined : value === "" && emptyLabel ? emptyLabel : placeholder}
        className={`input ${value ? "pr-16" : "pr-10"}`}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(e) => e.currentTarget.select()}
        onClick={() => setOpen(true)}
        onBlur={() => {
          // Typed something but didn't pick: an empty box means "none", anything else goes back to the last choice.
          if (query !== null && !query.trim()) pick(null);
          else setQuery(null);
          setOpen(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              const at = items.findIndex((o) => (o?.id ?? "") === value);
              setActive(Math.max(0, at));
              return;
            }
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (items.length ? (i + step + items.length) % items.length : 0));
          } else if (e.key === "Enter") {
            // With the list open Enter picks; with it closed, Enter submits the form as usual.
            if (open && items.length) {
              e.preventDefault();
              pick(items[active] ?? null);
            }
          } else if (e.key === "Tab") {
            if (open && query?.trim() && items.length) pick(items[active] ?? null);
          } else if (e.key === "Escape") {
            if (open || query !== null) {
              // Close the list, not the pop-up it's in.
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
              setQuery(null);
            }
          } else if ((e.key === "Home" || e.key === "End") && open && query === null) {
            e.preventDefault();
            setActive(e.key === "Home" ? 0 : items.length - 1);
          }
        }}
      />
      {value ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Clear"
          title="Clear"
          className="absolute top-1/2 right-9 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-400 hover:bg-ink-100 hover:text-ink-950"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            pick(null);
            ownRef.current?.focus();
            setOpen(true);
            setActive(0);
          }}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      ) : null}
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? "Close list" : "Show list"}
        className="absolute top-1/2 right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-400 hover:text-ink-950"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          ownRef.current?.focus();
          setOpen((o) => !o);
        }}
      >
        <svg
          viewBox="0 0 24 24"
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={emptyLabel ?? placeholder}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto overscroll-contain rounded-xl border border-ink-200 bg-white p-1 shadow-xl"
          // Clicking the list mustn't take focus away from the box.
          onMouseDown={(e) => e.preventDefault()}
        >
          {items.map((o, i) => {
            const selected = (o?.id ?? "") === value;
            return (
              <li
                key={o?.id ?? ""}
                id={optionId(i)}
                data-index={i}
                role="option"
                aria-selected={selected}
                className={`flex cursor-pointer items-baseline gap-2 rounded-lg px-3 py-2 text-sm ${i === active ? "bg-ink-100 text-ink-950" : "text-ink-800"}`}
                onMouseMove={() => i !== active && setActive(i)}
                onClick={() => pick(o)}
              >
                <span className={`min-w-0 flex-1 truncate ${o ? "" : "text-ink-500 italic"} ${selected ? "font-semibold" : ""}`}>
                  {o ? o.name : emptyLabel}
                </span>
                {o?.detail && <span className="shrink-0 truncate text-xs text-ink-500">{o.detail}</span>}
                {selected && (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 self-center text-ink-950"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.25}
                    aria-hidden
                  >
                    <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </li>
            );
          })}
          {!matches.length && typed.trim() && (
            <li role="presentation" className="px-3 py-2 text-sm text-ink-500">
              Nothing matches &ldquo;{typed.trim()}&rdquo;
            </li>
          )}
          {hidden > 0 && (
            <li role="presentation" className="px-3 py-2 text-xs text-ink-500">
              {hidden} more: keep typing to narrow it down
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
