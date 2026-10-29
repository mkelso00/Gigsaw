"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/forms";

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

/**
 * A form wired to a server action that may return an error message.
 * Submits by hand rather than through the form's action prop, because React clears every
 * field after an action-prop submission, which would wipe the user's input on a validation
 * error. Fields are cleared only after a successful save.
 */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  children: React.ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  const [dismissed, setDismissed] = useState<FormState>(undefined);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
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
        startTransition(() => formAction(data));
      }}
    >
      <div ref={messageRef} className="col-span-full scroll-mt-24" />
      {state?.error && (
        <div role="alert" className="col-span-full mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </div>
      )}
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
      {state?.ok && (
        <div role="status" className="col-span-full mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.ok}
        </div>
      )}
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
    </form>
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
