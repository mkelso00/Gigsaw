import type { Metadata } from "next";
import Link from "next/link";
import { addEnquiry } from "@/actions/enquiries";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { ENQUIRY_CHANNELS, ENQUIRY_EVENT_TYPES } from "@/lib/enquiries";

export const metadata: Metadata = { title: "Add enquiry" };

/** An enquiry that came by email or phone, typed in by staff. It's saved just like one from the website form. */
export default async function NewEnquiryPage() {
  await requireStaff();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={
          <Link href="/enquiries" className="hover:underline">
            Enquiries
          </Link>
        }
        title="Add an enquiry"
        subtitle="For enquiries that come by email or phone. The customer is added (or found, if their email is already on file) with a note, and a date makes a wedding or an Enquiry booking, just like the form on your website."
      />
      <ActionForm action={addEnquiry} className="space-y-6">
        <section className="card card-pad grid gap-4 sm:grid-cols-2">
          <h2 className="section-title sm:col-span-2">The customer</h2>
          <Field label="Name" className="sm:col-span-2">
            <input name="name" required maxLength={100} autoComplete="off" className="input" />
          </Field>
          <Field label="Email" hint="Matched to a customer already on file with this email.">
            <input name="email" type="email" maxLength={200} autoComplete="off" className="input" />
          </Field>
          <Field label="Phone">
            <input name="phone" type="tel" maxLength={40} autoComplete="off" className="input" />
          </Field>
          <Field label="How it came in">
            <select name="channel" defaultValue="EMAIL" className="input">
              {ENQUIRY_CHANNELS.filter((c) => c.value !== "WEBSITE").map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section className="card card-pad grid gap-4 sm:grid-cols-2">
          <h2 className="section-title sm:col-span-2">The event</h2>
          <Field label="Type of event">
            <select name="eventType" defaultValue="WEDDING" className="input">
              {ENQUIRY_EVENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date" hint="Leave empty if they don't know yet: no booking is made until there's a date.">
            <input name="date" type="date" className="input" />
          </Field>
          <Field label="Start time">
            <input name="startTime" type="time" className="input" />
          </Field>
          <Field label="Finish time">
            <input name="endTime" type="time" className="input" />
          </Field>
          <Field label="Venue or town" className="sm:col-span-2">
            <input name="venue" maxLength={200} className="input" />
          </Field>
          <Field label="Number of guests">
            <input name="guests" inputMode="numeric" className="input" />
          </Field>
          <Field label="Budget">
            <input name="budget" maxLength={100} placeholder="e.g. about £1,500" className="input" />
          </Field>
          <Field label="Message or notes" className="sm:col-span-2">
            <textarea name="message" rows={5} maxLength={3000} placeholder="What they asked for, paste their email, or notes from the call" className="input" />
          </Field>
        </section>

        <label className="flex items-start gap-3 rounded-xl bg-white p-4 text-sm ring-1 ring-ink-200">
          <input type="checkbox" name="autoReply" className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            <span className="font-medium">Send them the automatic “Thanks for your enquiry” email</span>
            <span className="block text-ink-500">Off unless you tick it. It needs their email address.</span>
          </span>
        </label>

        <div className="flex flex-wrap gap-2">
          <SubmitButton pendingText="Adding…">Add enquiry</SubmitButton>
          <Link href="/enquiries" className="btn">
            Cancel
          </Link>
        </div>
      </ActionForm>
    </div>
  );
}
