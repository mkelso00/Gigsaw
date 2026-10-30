"use client";

import { useRef, useState } from "react";
import { fillPlaceholders } from "@/lib/message-templates";

type FieldKey = "subject" | "intro" | "text";

const LABELS: Record<string, string> = {
  first_name: "First name",
  act: "Act",
  venue: "Venue",
  date: "Date",
  time: "Arrive-by time",
  business: "Your business name",
  event: "Wedding or event",
  name: "Their name",
  event_type: "Type of event",
};

// Made-up details for the preview.
const SAMPLE: Record<string, string> = {
  first_name: "Sam",
  act: "The Late Shows",
  venue: "The Crown",
  date: "Fri 14 Nov",
  time: "19:30",
  event: "Alex and Jo's wedding",
  name: "Sam Jones",
  event_type: "Wedding",
};

const LIMITS: Record<FieldKey, number> = { subject: 200, intro: 2000, text: 320 };

/**
 * The wording boxes for one automatic message (Settings > Notifications): subject, message and
 * text. Click a placeholder to put it where the cursor is; a preview shows it filled in.
 */
export function TemplateFields({
  example,
  values,
  placeholders,
  business,
}: {
  example: { subject: string; intro: string; text?: string };
  values: { subject: string; intro: string; text: string };
  placeholders: string[];
  business: string;
}) {
  const [v, setV] = useState(values);
  const refs = { subject: useRef<HTMLInputElement>(null), intro: useRef<HTMLTextAreaElement>(null), text: useRef<HTMLTextAreaElement>(null) };
  // The box a placeholder goes into: the last one used.
  const [target, setTarget] = useState<FieldKey>("intro");
  const fields: { key: FieldKey; label: string; hint: string }[] = [
    { key: "subject", label: "Email subject", hint: "" },
    { key: "intro", label: "Message", hint: "The opening of the email. The details and buttons are added underneath." },
    ...(example.text ? [{ key: "text" as const, label: "Text message", hint: "For people without the app. Any link is added at the end." }] : []),
  ];

  // Change a box the way typing would, so the form notices (and offers to save).
  const write = (key: FieldKey, next: string, caret?: number) => {
    const el = refs[key].current;
    if (!el) return;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    if (caret != null) el.setSelectionRange(caret, caret);
  };

  const insert = (p: string) => {
    const el = refs[target].current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    // A space before it when it would otherwise run on from a word or full stop.
    const token = `${start > 0 && /[^\s([{"“']/.test(el.value[start - 1]) ? " " : ""}{${p}}`;
    write(target, el.value.slice(0, start) + token + el.value.slice(end), start + token.length);
  };

  const vars = { ...SAMPLE, business: business || "Your business" };
  const shown = (key: FieldKey) => fillPlaceholders(v[key].trim() || (key === "text" ? (example.text ?? "") : example[key]), vars);

  return (
    <div className="space-y-5">
      <div>
        <div className="label">Placeholders</div>
        <p className="mb-2 text-xs text-ink-500">Click one to add it where your cursor is in the box you were last in. Each is filled in for every message.</p>
        <div className="flex flex-wrap gap-2">
          {placeholders.map((p) => (
            <button
              key={p}
              type="button"
              // Keep the cursor in the box while clicking.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insert(p)}
              className="rounded-lg border border-ink-200 px-2.5 py-1 text-left text-sm hover:border-ink-400 hover:bg-ink-50"
              title={`Add {${p}}`}
            >
              <code className="font-semibold">{`{${p}}`}</code> <span className="text-ink-500">{LABELS[p] ?? p}</span>
            </button>
          ))}
        </div>
      </div>

      {fields.map(({ key, label, hint }) => {
        const def = key === "text" ? (example.text ?? "") : example[key];
        const common = {
          name: key,
          value: v[key],
          maxLength: LIMITS[key],
          placeholder: def,
          className: "input",
          id: `tpl-${key}`,
          onFocus: () => setTarget(key),
          onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [key]: e.target.value })),
        };
        return (
          <div key={key}>
            <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3">
              <label htmlFor={`tpl-${key}`} className="text-[13px] font-medium text-ink-800">
                {label}
                {target === key && <span className="ml-2 text-xs font-normal text-ink-500">placeholders go here</span>}
              </label>
              {v[key].trim() ? (
                <button type="button" onClick={() => write(key, "")} className="text-xs text-ink-500 underline hover:text-ink-950">
                  Use Gigsaw&apos;s wording
                </button>
              ) : (
                <button type="button" onClick={() => write(key, def, def.length)} className="text-xs text-ink-500 underline hover:text-ink-950">
                  Edit Gigsaw&apos;s wording
                </button>
              )}
            </div>
            {key === "subject" ? (
              <input ref={refs.subject} {...common} />
            ) : (
              <textarea ref={key === "intro" ? refs.intro : refs.text} rows={key === "intro" ? 4 : 2} {...common} />
            )}
            <div className="hint flex flex-wrap justify-between gap-x-3">
              <span>{v[key].trim() ? hint : `Empty: Gigsaw's wording (in grey) is used. ${hint}`}</span>
              {key === "text" && (
                <span className={`tabular-nums ${shown("text").length > 160 ? "text-amber-700" : ""}`}>
                  {shown("text").length} characters{shown("text").length > 160 ? ": over 160 goes as two texts" : ""}
                </span>
              )}
            </div>
          </div>
        );
      })}

      <div className="rounded-xl border border-dashed border-ink-300 p-4">
        <div className="eyebrow mb-2">Preview, with made-up details</div>
        <div className="text-sm font-semibold text-ink-950">{shown("subject")}</div>
        <p className="mt-1 text-sm whitespace-pre-line text-ink-700">{shown("intro")}</p>
        <p className="mt-2 text-xs text-ink-500">The venue, date, times and links follow here.</p>
        {example.text && (
          <div className="mt-3 border-t border-ink-100 pt-3">
            <div className="text-xs text-ink-500">Text message</div>
            <p className="mt-1 text-sm text-ink-700">{shown("text")}</p>
          </div>
        )}
      </div>
    </div>
  );
}
