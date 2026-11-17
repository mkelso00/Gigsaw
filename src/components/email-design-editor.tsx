"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DESIGN_PRESETS, isHexColour, parseSteps, websiteUrl, type EmailDesign } from "@/lib/email-design";
import { sampleEnquiryEmail } from "@/lib/email-design-sample";
import { renderEmail } from "@/lib/message-format";

/**
 * Settings → Email design: the fields (plain, so the settings form saves them) and a live preview of the
 * enquiry reply beside them. Presets fill in both colours the way typing would, so Save notices.
 */
export function EmailDesignEditor({ design, business, email, logoUrl }: { design: EmailDesign; business: string; email: string; logoUrl: string | null }) {
  const box = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState(design);
  const [stepsText, setStepsText] = useState(design.steps.join("\n"));
  const [logo, setLogo] = useState<string | null>(logoUrl);
  const [removeLogo, setRemoveLogo] = useState(false);

  // Read what the fields hold now (after typing, a preset, or Discard).
  const read = useCallback(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const f = new FormData(form);
    const get = (k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
    setValues((v) => ({
      header: isHexColour(get("header")) ? get("header") : v.header,
      accent: isHexColour(get("accent")) ? get("accent") : v.accent,
      website: websiteUrl(get("website")),
      phone: get("phone").trim(),
      buttonLabel: get("buttonLabel").trim(),
      steps: parseSteps(get("steps")),
    }));
    setStepsText(get("steps"));
    setRemoveLogo(get("logoRemove") === "on");
  }, []);

  // A new logo saved: show the stored one.
  useEffect(() => setLogo(logoUrl), [logoUrl]);

  // Discard resets the form: catch that too.
  useEffect(() => {
    const form = box.current?.closest("form");
    if (!form) return;
    const onReset = () =>
      setTimeout(() => {
        read();
        setLogo(logoUrl);
      }, 0);
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [read, logoUrl]);

  const setField = (name: string, value: string) => {
    const el = box.current?.querySelector<HTMLInputElement>(`input[name="${name}"]`);
    if (!el) return;
    // Set it the way typing does, so the form sees a change (and shows Save).
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const html = useMemo(() => {
    const look = { logoUrl: !removeLogo && logo ? logo : undefined };
    return renderEmail(sampleEnquiryEmail(business, { ...values, steps: parseSteps(stepsText) }, look, email)).html;
  }, [values, stepsText, logo, removeLogo, business, email]);

  return (
    <div ref={box} onInput={read} onChange={read} className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="space-y-8">
        <section>
          <h2 className="section-title">Logo</h2>
          <p className="hint mt-1 mb-3">At the top of every email, on the header colour. A PNG with a see-through background works best. Up to 1 MB.</p>
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex h-16 min-w-32 items-center justify-center rounded-xl px-4" style={{ background: values.header }}>
              {logo && !removeLogo ? (
                // eslint-disable-next-line @next/next/no-img-element -- the logo as the email shows it
                <img src={logo} alt="Your logo" className="max-h-11 max-w-[200px] object-contain" />
              ) : (
                <span className="text-sm opacity-70" style={{ color: values.header === "#f4f1ea" ? "#15181c" : "#fff" }}>
                  No logo
                </span>
              )}
            </div>
            <label className="btn cursor-pointer">
              {logoUrl ? "Change logo" : "Upload logo"}
              <input
                type="file"
                name="logo"
                accept="image/png,image/jpeg,image/gif"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return setLogo(logoUrl);
                  // As a data address, so the preview (a locked-down frame) can show it.
                  const r = new FileReader();
                  r.onload = () => setLogo(typeof r.result === "string" ? r.result : logoUrl);
                  r.readAsDataURL(f);
                }}
              />
            </label>
            {logoUrl && (
              <label className="flex items-center gap-2 text-sm text-ink-600">
                <input type="checkbox" name="logoRemove" className="h-4 w-4" /> Remove the logo
              </label>
            )}
          </div>
        </section>

        <section>
          <h2 className="section-title">Colours</h2>
          <p className="hint mt-1 mb-3">Pick a ready-made pair, or choose your own. Text on them turns white or black by itself so it&apos;s easy to read.</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {DESIGN_PRESETS.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => {
                  setField("header", p.header);
                  setField("accent", p.accent);
                }}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                  values.header === p.header && values.accent === p.accent ? "border-ink-950 bg-ink-50" : "border-ink-200 hover:border-ink-400"
                }`}
              >
                <span className="flex">
                  <span className="h-4 w-4 rounded-full border border-black/10" style={{ background: p.header }} />
                  <span className="-ml-1.5 h-4 w-4 rounded-full border border-black/10" style={{ background: p.accent }} />
                </span>
                {p.name}
              </button>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ["header", "Header", "Behind your logo at the top"],
                ["accent", "Accent", "Buttons, step numbers and the summary box"],
              ] as const
            ).map(([name, label, hint]) => (
              <label key={name} className="block">
                <span className="label">{label}</span>
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${label} colour picker`}
                    className="h-11 w-14 cursor-pointer rounded-lg border border-ink-200 bg-white p-1"
                    value={values[name]}
                    onChange={(e) => setField(name, e.target.value)}
                  />
                  <input name={name} defaultValue={design[name]} pattern="#[0-9a-fA-F]{6}" className="input font-mono" maxLength={7} required />
                </span>
                <span className="hint block">{hint}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <h2 className="section-title">Footer and button</h2>
          <p className="hint mt-1 mb-3">Your business email (from Settings → General), phone and website go at the bottom of every email.</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Website</span>
              <input name="website" defaultValue={design.website.replace(/^https:\/\//, "")} placeholder="yourbusiness.co.uk" className="input" />
            </label>
            <label className="block">
              <span className="label">Phone</span>
              <input name="phone" defaultValue={design.phone} placeholder="07700 900123" className="input" />
            </label>
            <label className="block sm:col-span-2">
              <span className="label">Button in the enquiry reply</span>
              <input name="buttonLabel" defaultValue={design.buttonLabel} placeholder="See our acts" maxLength={40} className="input" />
              <span className="hint block">It opens your website. Leave it empty (or the website empty) for no button.</span>
            </label>
          </div>
        </section>

        <section>
          <h2 className="section-title">Enquiry reply: what happens next</h2>
          <p className="hint mt-1 mb-3">Numbered steps under their enquiry, one a line (up to 5). Leave it empty to leave the section out.</p>
          <textarea name="steps" rows={4} defaultValue={design.steps.join("\n")} className="input" />
        </section>
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="section-title">Preview</h2>
          <span className="text-xs text-ink-500">The enquiry reply, with a made-up enquiry</span>
        </div>
        <iframe title="Email preview" srcDoc={html} sandbox="" className="h-[860px] w-full rounded-2xl border border-ink-200 bg-[#eef0f2]" />
      </div>
    </div>
  );
}
