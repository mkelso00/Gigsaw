import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContractAudit, ContractBody } from "@/components/contract";
import { DocumentShell } from "@/components/document";
import { requireStaff } from "@/lib/auth";
import { asContractDoc } from "@/lib/contract-doc";
import { getSettings, prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Signed contract" };

/** A signed contract exactly as the client signed it, with the signature and the signing record. Agency staff only. */
export default async function SignedContractPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const [c, settings] = await Promise.all([
    prisma.contract.findFirst({ where: { id, agencyId: user.agencyId, status: "SIGNED" } }),
    getSettings(user.agencyId),
  ]);
  const doc = asContractDoc(c?.content);
  if (!c || !doc || !c.signedAt) notFound();
  const tz = settings.defaultTimezone;
  return (
    <DocumentShell
      title={doc.title}
      reference={doc.reference}
      settings={{ agencyName: doc.agency.name, agencyAddress: doc.agency.address, agencyEmail: doc.agency.email }}
    >
      <ContractBody doc={doc} timeZone={tz} signature={{ name: c.signedName, image: c.signature, signedAt: c.signedAt }} />
      <ContractAudit c={{ ...c, signedAt: c.signedAt }} timeZone={tz} />
    </DocumentShell>
  );
}
