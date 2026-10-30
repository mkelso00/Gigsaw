import type { Metadata } from "next";
import { ContractBody } from "@/components/contract";
import { DocumentShell } from "@/components/document";
import { agencySignatureOf, bookingContractDoc } from "@/lib/contract-doc";
import { loadPrintable } from "@/lib/print";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Contract" };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, settings } = await loadPrintable(id);
  const doc = bookingContractDoc(b, settings);
  return (
    <DocumentShell title={doc.title} reference={doc.reference} settings={settings}>
      <ContractBody doc={doc} timeZone={b.timezone} agencySignature={agencySignatureOf(settings)} />
      <p className="mt-8 text-xs text-slate-400">Issued {formatDateTime(new Date(), settings.defaultTimezone)}</p>
    </DocumentShell>
  );
}
