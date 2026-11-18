import type { Metadata } from "next";
import { createContact } from "@/actions/crm";
import { ContactForm } from "@/components/crm-forms";
import { PageHeader } from "@/components/ui";
import { requireStaff } from "@/lib/auth";
import { CONTACT_TYPES } from "@/lib/constants";
import { contractTemplatesFor } from "@/lib/contract-templates-server";

export const metadata: Metadata = { title: "Add contact" };

export default async function NewContactPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const user = await requireStaff();
  const { type } = await searchParams;
  const valid = (CONTACT_TYPES as readonly string[]).includes(type ?? "") ? type : undefined;
  const contractTypes = await contractTemplatesFor(user.agencyId);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title={valid === "CLIENT" ? "Add a private customer" : "Add contact"}
        subtitle={
          valid === "CLIENT" ? "Someone booking for a wedding, party or private event." : "Venue companies, private customers, venue staff and collaborators."
        }
      />
      <ContactForm action={createContact} defaultType={valid} contractTypes={contractTypes} />
    </div>
  );
}
