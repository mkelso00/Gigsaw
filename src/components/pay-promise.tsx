"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The words of the customer's "I accept" tick that depend on how they've chosen to pay the balance: follows the
 * payPlan radios (or the one hidden choice) in the same form, so the tick always names what they'll pay.
 */
export function PayPromise({ promises, fallback }: { promises: Record<string, string>; fallback: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [choice, setChoice] = useState("");
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const read = () => {
      const field = form.elements.namedItem("payPlan") as RadioNodeList | HTMLInputElement | null;
      setChoice(field?.value ?? "");
    };
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, []);
  return (
    <span ref={ref} data-testid="pay-promise">
      {promises[choice] ?? fallback}
    </span>
  );
}
