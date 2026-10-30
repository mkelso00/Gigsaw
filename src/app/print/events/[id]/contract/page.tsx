import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ContractBody } from "@/components/contract";
import { DocumentShell } from "@/components/document";
import { requireStaff } from "@/lib/auth";
import { contractSubject } from "@/lib/contracts";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Contract" };

/** One contract for the customer covering every act at their wedding or event. Agency staff only. */
export default async function EventContractPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff();
  const { id } = await params;
  const s = await contractSubject(user.agencyId, { kind: "event", id });
  if (!s) notFound();
  return (
    <DocumentShell title={s.doc.title} reference={s.doc.reference} settings={s.settings}>
      <ContractBody doc={s.doc} timeZone={s.timeZone} />
      <p className="mt-8 text-xs text-slate-400">Issued {formatDateTime(new Date(), s.settings.defaultTimezone)}</p>
    </DocumentShell>
  );
}
