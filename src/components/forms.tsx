"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { formErrorFromDigest, type FormState } from "@/lib/forms";

export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingText = "Saving…",
  name,
  value,
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
  /** Sent with the form when this button is pressed, e.g. name="mode" value="offer". */
  name?: string;
  value?: string;
}) {
  const { pending: formPending } = useFormStatus();
  const actionPending = useContext(PendingContext);
  const pending = formPending || actionPending;
  return (
    <button type="submit" name={name} value={value} className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

const PendingContext = createContext(false);

/** Where a server action's redirect() is sending the browser, from the error Next hands back for it. */
function redirectFrom(e: unknown): { url: string; replace: boolean } | null {
  const digest = typeof e === "object" && e !== null && "digest" in e ? (e as { digest: unknown }).digest : null;
  if (typeof digest !== "string" || !digest.startsWith("NEXT_REDIRECT;")) return null;
  // "NEXT_REDIRECT;push;/quotes/abc;307;". The address itself can hold ";", so take everything between type and status.
  const parts = digest.split(";");
  const url = parts.slice(2, -2).join(";");
  return url ? { url, replace: parts[1] === "replace" } : null;
}

/** Everything a form would send, as one string, to tell whether anything has changed. */
function snapshot(form: HTMLFormElement) {
  return JSON.stringify([...new FormData(form)].map(([k, v]) => [k, typeof v === "string" ? v : v.name]));
}

/**
 * A form wired to a server action that may return an error message.
 * Submits by hand rather than through the form's action prop, because React clears every
 * field after an action-prop submission, which would wipe the user's input on a validation
 * error. Fields are cleared only after a successful save.
 *
 * `saveBar` (settings pages): the Save button sits at the foot of the form, and once anything
 * changes it becomes a bar stuck to the bottom of the screen with "Unsaved changes", Discard and
 * Save, like Shopify. "Saved" shows there afterwards instead of a banner at the top.
 */
export function ActionForm({
  action,
  children,
  className,
  saveBar,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
  saveBar?: boolean | { label: string };
}) {
  // The action runs outside a React transition, with its own busy flag. Inside a transition (useActionState) the
  // button stayed on "Saving…" for good about one save in three: the server had saved and sent the new page back,
  // but React never finished showing it. Here the button frees itself once the server answers, and the page is
  // asked for again so it always shows what was saved.
  const router = useRouter();
  const [state, setState] = useState<FormState>(undefined);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [, setCrash] = useState();
  /** Opens where the action sent us. True if that's another page, false if it's this one (just shown again). */
  const go = (to: { url: string; replace: boolean }) => {
    if (to.replace) router.replace(to.url);
    else router.push(to.url);
    // Next occasionally never finishes moving to the new page. If the address hasn't changed after a few
    // seconds, open the page directly so nobody is left looking at a form that has already been saved.
    const target = new URL(to.url, window.location.href);
    const here = () => window.location.pathname + window.location.search;
    if (here() === target.pathname + target.search) return false;
    setTimeout(() => {
      if (here() !== target.pathname + target.search) window.location.assign(target.href);
    }, 4000);
    return true;
  };
  const formAction = async (data: FormData) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    let moving = false;
    try {
      const next = await action(state, data);
      setState(next);
      router.refresh();
    } catch (e) {
      // A redirect from the action (e.g. "Save" then back to the page) arrives as an error: go there.
      const to = redirectFrom(e);
      // A refusal thrown before the action's own error handling (e.g. a locked plan) still shows as a message.
      const message = to ? null : formErrorFromDigest(e);
      // The button stays on "Saving…" while the next page opens, so it can't be pressed twice.
      if (to) moving = go(to);
      else if (message) setState({ error: message });
      // Anything else goes to the page's error screen, as it would from a render.
      else
        setCrash(() => {
          throw e;
        });
    } finally {
      if (!moving) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  const ref = useRef<HTMLFormElement>(null);
  const [dismissed, setDismissed] = useState<FormState>(undefined);
  // What the form held when it was loaded or last saved, to tell when something has changed.
  const baseline = useRef("");
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const hasBar = !!saveBar;
  const check = () => {
    if (hasBar && ref.current) setDirty(snapshot(ref.current) !== baseline.current);
  };
  useEffect(() => {
    if (ref.current) baseline.current = snapshot(ref.current);
  }, []);
  useEffect(() => {
    if (!state?.ok) return;
    ref.current?.reset();
    if (!hasBar || !ref.current) return;
    baseline.current = snapshot(ref.current);
    setDirty(false);
    setSaved(true);
    const t = setTimeout(() => setSaved(false), 5000);
    return () => clearTimeout(t);
  }, [state, hasBar]);
  // Closing or reloading the tab with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const confirm = state?.confirm && dismissed !== state ? state.confirm : null;
  // On long forms the message sits at the top, far from the button that was pressed: bring it into view.
  const messageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (state?.error || state?.confirm) messageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [state]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        // Include the button that was pressed, so "Save anyway" can send confirmed=yes.
        const data = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        void formAction(data);
      }}
      onChange={() => {
        // A warning was about what the form held then: once something changes it's checked again on the next save,
        // so Enter in a field can't press "Save anyway" for times or dates it never looked at.
        if (confirm) setDismissed(state);
        setSaved(false);
        check();
      }}
      onReset={() => setTimeout(check, 0)}
    >
      <div ref={messageRef} className="col-span-full scroll-mt-24" />
      {state?.error && (
        <div role="alert" className="col-span-full mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </div>
      )}
      {/* Enter in a field is a plain save: this hidden first button is the one it presses, not "Save anyway". */}
      {confirm && <button type="submit" className="hidden" tabIndex={-1} aria-hidden />}
      {confirm && (
        <div role="alert" className="col-span-full mb-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 font-bold text-ink-950">!</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{confirm.title}</div>
              <ul className="mt-2 space-y-2">
                {confirm.items.map((item) => (
                  <li key={item} className="leading-relaxed">
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="submit"
                  name="confirmed"
                  value="yes"
                  className="btn btn-sm border-amber-500 bg-amber-400 text-ink-950 hover:bg-amber-300"
                  disabled={pending}
                >
                  {confirm.button ?? "Save anyway"}
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setDismissed(state)}>
                  Go back
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {state?.ok && !saveBar && (
        <div role="status" className="col-span-full mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.ok}
        </div>
      )}
      <PendingContext.Provider value={pending}>
        {children}
        {saveBar && (
          <SaveBar
            dirty={dirty}
            saved={saved ? (state?.ok ?? "Saved.") : null}
            label={typeof saveBar === "object" ? saveBar.label : "Save"}
            onDiscard={() => ref.current?.reset()}
          />
        )}
      </PendingContext.Provider>
    </form>
  );
}

/** The Save button at the foot of a settings form. While there are unsaved changes it sticks to the bottom of the screen. */
function SaveBar({ dirty, saved, label, onDiscard }: { dirty: boolean; saved: string | null; label: string; onDiscard: () => void }) {
  return (
    <div className={`col-span-full ${dirty ? "sticky bottom-3 z-20" : ""}`}>
      <div
        className={`flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-2xl ${
          dirty ? "bg-ink-950 py-2.5 pr-2.5 pl-4 text-white shadow-[0_12px_32px_-8px_rgb(0_0_0/0.45)] ring-1 ring-white/10" : ""
        }`}
      >
        {dirty ? (
          <span className="mr-auto flex items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 rounded-full bg-amber-400" aria-hidden />
            Unsaved changes
          </span>
        ) : saved ? (
          <span role="status" className="mr-auto flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.5} aria-hidden>
              <path d="m5 12 5 5 9-10" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {saved}
          </span>
        ) : null}
        {dirty && (
          <button type="button" onClick={onDiscard} className="btn bg-transparent h-9 border-white/25 px-3 text-white hover:border-white/50 hover:bg-white/10">
            Discard
          </button>
        )}
        <SubmitButton className={dirty ? "btn btn-volt h-9 px-4" : "btn btn-primary"}>{label}</SubmitButton>
      </div>
    </div>
  );
}

/** A button that asks for confirmation before submitting its form. */
export function ConfirmButton({ children, message, className = "btn btn-danger" }: { children: React.ReactNode; message: string; className?: string }) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
