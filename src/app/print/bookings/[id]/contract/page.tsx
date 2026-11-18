import type { Metadata } from "next";
import { ContractBody } from "@/components/contract";
import { DocumentShell } from "@/components/document";
import { notFound } from "next/navigation";
import { agencySignatureOf } from "@/lib/contract-doc";
import { contractSubject } from "@/lib/contracts";
import { loadPrintable } from "@/lib/print";
import { formatDateTime } from "@/lib/time";

export const metadata: Metadata = { title: "Contract" };

export default async function ContractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { booking: b, settings } = await loadPrintable(id);
  // The same contract the client signs: the booking with the contract type it uses.
  const subject = await contractSubject(b.agencyId, { kind: "booking", id: b.id });
  if (!subject) notFound();
  const doc = subject.doc;
  return (
    <DocumentShell
      title={doc.title}
      reference={doc.reference}
      settings={settings}
      toolbar={
        <>
          <OnlineNote />
          {!settings.signatureImage && <SignatureNudge />}
        </>
      }
    >
      <ContractBody doc={doc} timeZone={b.timezone} agencySignature={agencySignatureOf(settings)} />
      <p className="mt-8 text-xs text-slate-400">Issued {formatDateTime(new Date(), settings.defaultTimezone)}</p>
    </DocumentShell>
  );
}

function OnlineNote() {
  return (
    <span className="mr-auto flex items-center rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
      Preview only. The client signs and approves online: use Send contract to sign in the Contract box on the booking.
    </span>
  );
}

function SignatureNudge() {
  return (
    <span className="mr-auto flex items-center rounded-lg bg-amber-50 px-3 text-sm text-amber-900">
      Your signature isn&apos;t drawn yet, so your name shows in a handwriting style.&nbsp;
      <a href="/settings/documents#signature" className="font-medium underline">
        Draw it in Settings
      </a>
    </span>
  );
}
