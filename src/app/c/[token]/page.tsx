import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { signContract } from "@/actions/contracts";
import { PrintButton } from "@/components/client-bits";
import { ContractAudit, ContractBody } from "@/components/contract";
import { DocumentShell } from "@/components/document";
import { ActionForm, SubmitButton } from "@/components/forms";
import { SignaturePad } from "@/components/signature-pad";
import { currentUser } from "@/lib/auth";
import { asContractDoc, contractHash } from "@/lib/contract-doc";
import { liveContractDoc } from "@/lib/contracts";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/time";

// The client's contract: a private link (no login) to read it and sign it online. Works on a
// phone. Once signed, the same link shows their signed copy, which they can print or save.

export const metadata: Metadata = { title: "Your contract", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ContractSignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();
  const c = await prisma.contract.findUnique({ where: { token }, include: { agency: { include: { settings: true } } } });
  if (!c || c.agency.status !== "ACTIVE") notFound();
  const brand = c.agency.settings?.agencyName || c.agency.name;
  const contactLine = c.agency.settings?.agencyEmail ? ` at ${c.agency.settings.agencyEmail}` : "";

  if (c.status === "SIGNED") {
    const doc = asContractDoc(c.content);
    if (!doc) notFound();
    const tz = c.agency.settings?.defaultTimezone ?? "Europe/London";
    return (
      <DocumentShell
        title={doc.title}
        reference={doc.reference}
        settings={{ agencyName: doc.agency.name, agencyAddress: doc.agency.address, agencyEmail: doc.agency.email }}
        toolbar={
          <>
            <span className="mr-auto self-center rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800">
              Signed {formatDateTime(c.signedAt!, tz)}
            </span>
            <PrintButton />
          </>
        }
      >
        <ContractBody doc={doc} timeZone={tz} signature={{ name: c.signedName, image: c.signature, signedAt: c.signedAt! }} />
        <ContractAudit c={{ ...c, signedAt: c.signedAt! }} timeZone={tz} />
      </DocumentShell>
    );
  }

  const live = c.status === "SENT" ? await liveContractDoc(c) : null;
  if (!live || live.cancelled) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 text-ink-950">
        <div className="card card-pad max-w-md text-center">
          <div className="text-sm font-medium text-ink-500">{brand}</div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">This contract has been withdrawn</h1>
          <p className="mt-2 text-ink-600">
            There&apos;s nothing to sign here any more. If you were expecting a contract, please get in touch with {brand}
            {contactLine}.
          </p>
        </div>
      </div>
    );
  }

  // The first time the client opens it. Someone from the agency checking the link doesn't count.
  if (!c.viewedAt) {
    const me = await currentUser();
    if (me?.agencyId !== c.agencyId) await prisma.contract.updateMany({ where: { id: c.id, viewedAt: null }, data: { viewedAt: new Date() } });
  }
  const { doc, timeZone } = live;
  const hash = contractHash(doc);

  return (
    <DocumentShell
      title={doc.title}
      reference={doc.reference}
      settings={live.settings}
      toolbar={
        <p className="mr-auto text-sm text-ink-700">
          Hi {c.signerName.split(" ")[0]}, please read your contract from {brand}, then sign at the bottom.
        </p>
      }
      after={
        <div className="no-print mx-auto mt-4 max-w-3xl px-0 sm:mt-6 sm:px-0">
          <ActionForm action={signContract.bind(null, token, hash)} className="bg-white p-5 shadow sm:rounded-xl sm:p-8">
            <h2 className="text-xl font-semibold tracking-tight">Sign your contract</h2>
            <p className="mt-1 text-sm text-ink-600">
              Signing online is just as binding as signing on paper. You&apos;ll be able to print or save a copy afterwards.
            </p>
            <label className="mt-5 block">
              <span className="label">Your full name</span>
              <input
                name="signedName"
                required
                autoComplete="name"
                defaultValue={c.signerName}
                className="input h-12 text-base"
                maxLength={120}
                aria-describedby="name-hint"
              />
              <span id="name-hint" className="hint block">
                As it should appear on the contract.
              </span>
            </label>
            <div className="mt-5">
              <span className="label">Your signature</span>
              <SignaturePad name="signature" />
            </div>
            <label className="mt-5 flex items-start gap-3 rounded-xl bg-ink-50 p-4 text-[15px]">
              <input type="checkbox" name="agree" required className="mt-0.5 h-6 w-6 shrink-0" />
              <span>
                I agree to this contract with {brand}, and I&apos;m signing it as the Client. I understand my typed name and drawn signature count as my
                signature.
              </span>
            </label>
            <SubmitButton className="btn btn-primary mt-5 h-12 w-full text-base" pendingText="Signing…">
              Sign the contract
            </SubmitButton>
            <p className="mt-3 text-center text-xs text-ink-500">
              We record your name, signature, the time, your IP address and device, and a fingerprint of the contract above, so there&apos;s a clear record of
              what was signed.
            </p>
          </ActionForm>
          <p className="mt-6 mb-4 px-4 text-center text-xs text-ink-400">
            This page is private to you. Questions? Reply to the email, or contact {brand}
            {contactLine}.
          </p>
        </div>
      }
    >
      <ContractBody doc={doc} timeZone={timeZone} />
    </DocumentShell>
  );
}
