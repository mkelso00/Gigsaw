"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/lib/forms";

export function SubmitButton({
  children,
  className = "btn btn-primary",
  pendingText = "Saving…",
}: {
  children: React.ReactNode;
  className?: string;
  pendingText?: string;
}) {
  const { pending: formPending } = useFormStatus();
  const actionPending = useContext(PendingContext);
  const pending = formPending || actionPending;
  return (
    <button type="submit" className={className} disabled={pending}>
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
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => formAction(data));
      }}
    >
      {state?.error && (
        <div role="alert" className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
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
