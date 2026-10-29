"use client";

import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import type { FormState } from "@/lib/forms";

type Option = { id: string; name: string };
type Values = {
  name?: string;
  type?: string;
  date?: string;
  customerId?: string | null;
  venueId?: string | null;
  venueText?: string;
  notes?: string;
  autoEmails?: boolean;
};

const TYPES = [
  ["WEDDING", "Wedding"],
  ["PRIVATE_PARTY", "Private party"],
  ["CORPORATE", "Corporate event"],
  ["OTHER", "Other event"],
] as const;

/** Create or edit a wedding or event: the customer (existing or new), the date and where. */
export function EventForm({
  action,
  values = {},
  customers,
  venues,
  submitLabel,
  editing = false,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  values?: Values;
  customers: Option[];
  venues: Option[];
  submitLabel: string;
  editing?: boolean;
}) {
  const [newCustomer, setNewCustomer] = useState(!values.customerId && !editing);
  const [venueOnFile, setVenueOnFile] = useState(!!values.venueId || !values.venueText);
  return (
    <ActionForm action={action} className="grid gap-4 sm:grid-cols-2">
      <label>
        <span className="label">Type</span>
        <select name="type" defaultValue={values.type ?? "WEDDING"} className="input">
          {TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span className="label">Date</span>
        <input name="date" type="date" required defaultValue={values.date} className="input" />
      </label>

      <div className="sm:col-span-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label mb-0">Customer</span>
          <button type="button" className="text-xs text-ink-500 underline hover:text-ink-950" onClick={() => setNewCustomer((v) => !v)}>
            {newCustomer ? "Choose an existing customer" : "New customer"}
          </button>
        </div>
        {newCustomer ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <input name="customerName" placeholder="Name, e.g. Hannah Brooks" className="input" />
            <input name="customerEmail" type="email" placeholder="Email" className="input" />
            <input name="customerPhone" type="tel" placeholder="Mobile" className="input" />
          </div>
        ) : (
          <select name="customerId" defaultValue={values.customerId ?? ""} className="input">
            <option value="">Not set yet</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <p className="hint">They get the planner link, the balance reminder and the thank-you by email.</p>
      </div>

      <div className="sm:col-span-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="label mb-0">Where</span>
          <button type="button" className="text-xs text-ink-500 underline hover:text-ink-950" onClick={() => setVenueOnFile((v) => !v)}>
            {venueOnFile ? "Somewhere not on file" : "Choose a venue on file"}
          </button>
        </div>
        {venueOnFile ? (
          <select name="venueId" defaultValue={values.venueId ?? ""} className="input">
            <option value="">Not set yet</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        ) : (
          <input name="venueText" defaultValue={values.venueText} placeholder="e.g. Marquee at Lower Farm, Hebden Bridge HX7 6AA" className="input" />
        )}
      </div>

      <label className="sm:col-span-2">
        <span className="label">Name</span>
        <input name="name" defaultValue={values.name} placeholder="Leave blank for e.g. “Hannah Brooks's wedding”" className="input" />
      </label>
      <label className="sm:col-span-2">
        <span className="label">Notes</span>
        <textarea name="notes" rows={3} defaultValue={values.notes} placeholder="Agency only: acts and customers never see this" className="input" />
      </label>
      {editing && (
        <label className="flex items-center justify-between gap-4 rounded-xl border border-ink-200 p-4 sm:col-span-2">
          <span>
            <span className="block text-sm font-medium">Automatic emails to the customer</span>
            <span className="block text-xs text-ink-500">Planner link, reminder, balance reminder and thank-you.</span>
          </span>
          <input type="checkbox" name="autoEmails" defaultChecked={values.autoEmails ?? true} className="switch" />
        </label>
      )}
      <div className="sm:col-span-2">
        <SubmitButton className="btn btn-primary">{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
