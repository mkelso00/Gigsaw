"use client";

import { useEffect, useRef, useState } from "react";
import { clientRecipient, NEW_CONTACT, type ClientPayer, type LeadPerson } from "@/lib/client-recipient";
import { personName } from "@/lib/person-name";

export type LeadOption = LeadPerson & { venueId: string | null; companyId: string | null; jobTitle: string };
export type LeadVenue = { id: string; name: string; leadContactId: string | null };
export type LeadPayer = Omit<ClientPayer, "leadContact"> & { id: string; leadContactId: string | null };

const HINTS: Record<ReturnType<typeof clientRecipient>["source"], string> = {
  BOOKING: "They get the client's messages for this booking: arrival notes, confirmations, contracts and payment links.",
  VENUE: "The venue's usual lead contact, set on the venue's page. Choose someone else here for this booking only.",
  COMPANY: "The company's usual lead contact, set on its page. Choose someone else here for this booking only.",
  CUSTOMER: "Weddings and private customers hear from you themselves. Choose someone here only if another person deals with it.",
  PAYER: "Nobody at the venue or the company is the lead contact yet, so messages go to who pays.",
  NONE: "Arrival notes and confirmations go to the client's lead contact. Choose the venue and who pays first.",
};

/**
 * "Client's lead contact" on the booking form: who the client's messages go to for this booking
 * (src/lib/client-recipient.ts). Lists the people at the chosen venue and at the paying company, follows the venue,
 * payer and booking type as they're picked, and says who "Automatic" means (by default the venue's lead contact).
 * "Someone new" asks for a name, email and phone, and the person is added to the venue (or the company) on save.
 */
export function ClientLeadPicker({
  people,
  venues,
  payers,
  defaultValue,
  inEvent,
}: {
  people: LeadOption[];
  venues: LeadVenue[];
  payers: LeadPayer[];
  defaultValue: string;
  /** Part of a wedding or event: it's the customer's, whatever its type. */
  inEvent: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState({ venueId: "", promoterId: "", eventType: "" });
  const [value, setValue] = useState(defaultValue);

  // Follow the venue, who pays and the booking type chosen elsewhere in the form.
  useEffect(() => {
    const el = ref.current?.closest("form");
    if (!el) return;
    const read = () => {
      const get = (n: string) => (el.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | null)?.value ?? "";
      setForm({ venueId: get("venueId"), promoterId: get("promoterId"), eventType: get("eventType") });
    };
    read();
    el.addEventListener("change", read);
    el.addEventListener("reset", read);
    return () => {
      el.removeEventListener("change", read);
      el.removeEventListener("reset", read);
    };
  }, []);

  const byId = new Map(people.map((p) => [p.id, p]));
  const venue = venues.find((v) => v.id === form.venueId) ?? null;
  const payer = payers.find((p) => p.id === form.promoterId) ?? null;
  const atVenue = venue ? people.filter((p) => p.venueId === venue.id) : [];
  const atCompany = payer ? people.filter((p) => p.companyId === payer.id) : [];
  // Someone chosen before who isn't at either any more (moved on, or the venue changed) stays listed.
  const current = value && value !== NEW_CONTACT && !atVenue.some((p) => p.id === value) && !atCompany.some((p) => p.id === value) ? byId.get(value) : null;

  const party = {
    eventId: inEvent ? "event" : null,
    eventType: form.eventType,
    venue: venue ? { name: venue.name, leadContact: venue.leadContactId ? byId.get(venue.leadContactId) : null } : null,
    promoter: payer ? { ...payer, leadContact: payer.leadContactId ? byId.get(payer.leadContactId) : null } : null,
  };
  const auto = clientRecipient(party);
  const chosen = value && value !== NEW_CONTACT ? byId.get(value) : null;
  const now = chosen ? clientRecipient({ ...party, clientContact: chosen }) : auto;
  const autoLabel =
    auto.source === "VENUE" || auto.source === "COMPANY"
      ? `Automatic: ${auto.label}`
      : auto.source === "CUSTOMER"
        ? `Automatic: the customer${auto.name ? ` (${auto.name})` : ""}`
        : auto.source === "PAYER"
          ? `Automatic: ${auto.label}`
          : "Automatic: nobody yet";
  const label = (p: LeadOption) => `${personName(p)}${p.jobTitle ? `, ${p.jobTitle}` : ""}`;
  const addTo = venue?.name ?? (payer && payer.type !== "CLIENT" ? payer.company || payer.name : "");

  return (
    <div ref={ref} className="space-y-2">
      <select
        id="bf-client-lead"
        name="clientContactId"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="input"
        aria-describedby="bf-client-lead-hint"
      >
        <option value="">{autoLabel}</option>
        {atVenue.length > 0 && (
          <optgroup label={`At ${venue!.name}`}>
            {atVenue.map((p) => (
              <option key={p.id} value={p.id}>
                {label(p)}
              </option>
            ))}
          </optgroup>
        )}
        {atCompany.length > 0 && (
          <optgroup label={`At ${payer!.company || payer!.name}`}>
            {atCompany.map((p) => (
              <option key={p.id} value={p.id}>
                {label(p)}
              </option>
            ))}
          </optgroup>
        )}
        {current && <option value={current.id}>{label(current)}</option>}
        <option value={NEW_CONTACT}>Someone new…</option>
      </select>
      {value === NEW_CONTACT ? (
        <div className="grid gap-2 rounded-xl border border-ink-200 p-3 sm:grid-cols-3">
          <label className="block">
            <span className="label">Name</span>
            <input name="newContactName" required className="input" autoComplete="off" />
          </label>
          <label className="block">
            <span className="label">Email</span>
            <input name="newContactEmail" type="email" className="input" autoComplete="off" />
          </label>
          <label className="block">
            <span className="label">Phone</span>
            <input name="newContactPhone" type="tel" className="input" autoComplete="off" />
          </label>
          <p className="hint sm:col-span-3">
            {addTo ? `Added to ${addTo}'s people when you save.` : "Added to People when you save. Choose the venue first to add them there."}
          </p>
        </div>
      ) : (
        <p id="bf-client-lead-hint" className="hint" data-testid="client-lead-hint">
          {now.hint || HINTS[now.source]}
        </p>
      )}
    </div>
  );
}
