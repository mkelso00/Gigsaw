"use client";

import Link from "next/link";
import { useState } from "react";
import { ActionForm, SubmitButton } from "@/components/forms";
import type { FormState } from "@/lib/forms";

type Values = {
  firstName?: string;
  surname?: string;
  alias?: string;
  pronouns?: string;
  company?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  social?: string;
  website?: string;
  address?: string;
  notes?: string;
  acts?: { name: string; jobTitle: string }[];
};

/**
 * Add or edit a person, laid out like Overture's: name, then one row per detail.
 * Company and act fields suggest existing venues, companies and acts as you type; a name that
 * doesn't exist yet is created when you save.
 */
export function PersonForm({
  action,
  values = {},
  actNames,
  companyNames,
  submitLabel,
  cancelHref,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  values?: Values;
  actNames: string[];
  companyNames: string[];
  submitLabel: string;
  cancelHref: string;
}) {
  const initialActs = values.acts?.length ? values.acts : [{ name: "", jobTitle: "" }];
  const [acts, setActs] = useState(initialActs);

  const row = (label: string, children: React.ReactNode, hint?: string) => (
    <div className="grid gap-2 border-t border-ink-100 py-4 sm:grid-cols-[160px_1fr] sm:items-start sm:gap-6">
      <div className="pt-2.5 text-sm font-medium text-ink-800">{label}</div>
      <div>
        {children}
        {hint && <p className="hint">{hint}</p>}
      </div>
    </div>
  );

  return (
    <ActionForm action={action} className="card card-pad">
      <datalist id="act-names">
        {actNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <datalist id="company-names">
        {companyNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="grid gap-4 pb-4 sm:grid-cols-2">
        <label>
          <span className="label">First name</span>
          <input name="firstName" required defaultValue={values.firstName} autoFocus={!values.firstName} className="input" />
        </label>
        <label>
          <span className="label">Surname</span>
          <input name="surname" defaultValue={values.surname} className="input" />
        </label>
      </div>

      {row(
        "Alias",
        <input name="alias" defaultValue={values.alias} placeholder="Stage or known-as name" className="input" />,
        "Shown instead of their full name when set.",
      )}
      {row("Pronouns", <input name="pronouns" defaultValue={values.pronouns} placeholder="e.g. she/her" className="input sm:max-w-xs" />)}
      {row(
        "Company",
        <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
          <input
            name="company"
            list="company-names"
            defaultValue={values.company}
            placeholder="A venue, promoter or company"
            className="input"
            autoComplete="off"
          />
          <input name="jobTitle" defaultValue={values.jobTitle} placeholder="Job title, e.g. Manager" className="input" />
        </div>,
        "Pick a venue to make them one of its contacts (e.g. the manager). A new name creates a new company.",
      )}
      {row(
        "Acts",
        <div className="space-y-2">
          {acts.map((a, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr_220px_auto]">
              <input name={`act_${i}`} list="act-names" defaultValue={a.name} placeholder="Act name, e.g. Wonderlust" className="input" autoComplete="off" />
              <input name={`actRole_${i}`} defaultValue={a.jobTitle} placeholder="Role, e.g. Lead vocals" className="input" />
              <button
                type="button"
                onClick={() => setActs((list) => (list.length > 1 ? list.filter((_, j) => j !== i) : [{ name: "", jobTitle: "" }]))}
                className="btn btn-sm self-center"
                aria-label="Remove this act"
              >
                Remove
              </button>
            </div>
          ))}
          {acts.length < 12 && (
            <button type="button" onClick={() => setActs((list) => [...list, { name: "", jobTitle: "" }])} className="btn btn-sm">
              + Another act
            </button>
          )}
        </div>,
        "A person can be in several acts, e.g. a band and their solo act. A new name creates a new act.",
      )}
      {row("Email address", <input name="email" type="email" defaultValue={values.email} className="input" />)}
      {row(
        "Phone number",
        <input name="phone" type="tel" defaultValue={values.phone} placeholder="07700 900000" className="input sm:max-w-xs" />,
        "Used for gig reminders and changes by text.",
      )}
      {row("Social media", <input name="social" defaultValue={values.social} placeholder="@handle" className="input" />)}
      {row("Website", <input name="website" defaultValue={values.website} placeholder="https://" className="input" />)}
      {row("Address", <textarea name="address" rows={3} defaultValue={values.address} className="input" />)}
      {row("Notes", <textarea name="notes" rows={3} defaultValue={values.notes} className="input" />)}

      <div className="flex items-center gap-2 border-t border-ink-100 pt-5">
        <SubmitButton className="btn btn-primary">{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn">
          Cancel
        </Link>
      </div>
    </ActionForm>
  );
}
