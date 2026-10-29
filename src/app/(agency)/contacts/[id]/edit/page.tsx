import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteContact, updateContact } from "@/actions/crm";
import { ContactForm } from "@/components/crm-forms";
import { ConfirmButton } from "@/components/forms";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Edit contact" };

export default async function EditContactPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) notFound();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title={`Edit ${contact.name}`} />
      <ContactForm action={updateContact.bind(null, contact.id)} contact={contact} />
      <form action={deleteContact.bind(null, contact.id)}>
        <ConfirmButton message={`Delete ${contact.name}? Their bookings stay but lose the link to this contact.`}>Delete contact</ConfirmButton>
      </form>
    </div>
  );
}
