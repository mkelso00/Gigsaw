import type { Metadata } from "next";
import { createContact } from "@/actions/crm";
import { ContactForm } from "@/components/crm-forms";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Add contact" };

export default async function NewContactPage() {
  await requireStaff();
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add contact" />
      <ContactForm action={createContact} />
    </div>
  );
}
