import { DocTable } from "@/components/document";
import type { ContractDoc } from "@/lib/contract-doc";
import { formatDateTime, zoneLabel } from "@/lib/time";

// The client contract, drawn from its data (src/lib/contract-doc.ts). The printed contract, the
// signing page and the signed copy all use this, so the client signs exactly what gets printed.

export type ContractSignature = {
  name: string;
  image: string;
  signedAt: Date;
};

export function ContractBody({ doc, signature, timeZone }: { doc: ContractDoc; signature?: ContractSignature | null; timeZone: string }) {
  const theAct = doc.plural ? "the Acts" : "the Act";
  return (
    <>
      <p className="mb-6">
        This agreement is made between <strong>{doc.client}</strong> (&ldquo;the Client&rdquo;) and <strong>{doc.agency.name}</strong> acting as agent for{" "}
        <strong>{doc.acts}</strong> (&ldquo;{doc.plural ? "the Acts" : "the Act"}&rdquo;).
      </p>
      {doc.sections.map((s, i) => (
        <section key={s.heading} className="break-inside-avoid-page">
          <h2 className={`${i ? "mt-6" : ""} mb-2 font-semibold`}>
            {i + 1}. {s.heading}
          </h2>
          {s.rows.length > 0 && <DocTable rows={s.rows} />}
          {s.text && <p className="text-sm whitespace-pre-line">{s.text}</p>}
        </section>
      ))}
      <div className="mt-12 grid gap-10 text-sm sm:grid-cols-2">
        <div className="break-inside-avoid">
          {signature ? (
            <div className="flex h-20 items-end border-b border-slate-400 pb-1">
              <img src={signature.image} alt={`Signature of ${signature.name}`} className="max-h-[76px] max-w-full object-contain" />
            </div>
          ) : (
            <div className="h-16 border-b border-slate-400" />
          )}
          <div className="mt-2">For the Client{signature ? `: ${signature.name}` : ""}</div>
          {signature ? (
            <div className="mt-1 text-slate-500">
              Signed online {formatDateTime(signature.signedAt, timeZone)} {zoneLabel(signature.signedAt, timeZone)}
            </div>
          ) : (
            <>
              <div className="mt-6 h-px border-b border-slate-300" />
              <div className="mt-1 text-slate-500">Date</div>
            </>
          )}
        </div>
        <div className="break-inside-avoid">
          <div className="flex h-16 items-end border-b border-slate-400 pb-1 font-serif text-xl italic">{doc.agency.name}</div>
          <div className="mt-2">
            For {doc.agency.name}, on behalf of {theAct}
          </div>
        </div>
      </div>
    </>
  );
}

export type ContractAuditInfo = {
  signedName: string;
  signerName: string;
  signerEmail: string;
  sentAt: Date;
  viewedAt: Date | null;
  signedAt: Date;
  signedIp: string;
  signedAgent: string;
  contentHash: string;
};

/** The record of how and when it was signed, printed under a signed contract. */
export function ContractAudit({ c, timeZone }: { c: ContractAuditInfo; timeZone: string }) {
  const at = (d: Date) => `${formatDateTime(d, timeZone)} ${zoneLabel(d, timeZone)}`;
  return (
    <section className="mt-10 break-inside-avoid rounded-lg border border-slate-200 p-4 text-xs text-slate-600">
      <h2 className="mb-2 text-sm font-semibold text-slate-800">Signing record</h2>
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[10rem_1fr]">
        <dt className="font-medium">Signed by</dt>
        <dd>{c.signedName} (typed name and drawn signature)</dd>
        <dt className="font-medium">Sent to</dt>
        <dd className="break-all">
          {c.signerName} &lt;{c.signerEmail}&gt;, {at(c.sentAt)}
        </dd>
        {c.viewedAt && (
          <>
            <dt className="font-medium">First opened</dt>
            <dd>{at(c.viewedAt)}</dd>
          </>
        )}
        <dt className="font-medium">Signed</dt>
        <dd>{at(c.signedAt)}, after ticking &ldquo;I agree&rdquo;</dd>
        <dt className="font-medium">IP address</dt>
        <dd>{c.signedIp || "Not known"}</dd>
        <dt className="font-medium">Device</dt>
        <dd className="break-all">{c.signedAgent || "Not known"}</dd>
        <dt className="font-medium">Contract fingerprint</dt>
        <dd className="font-mono break-all">SHA-256 {c.contentHash}</dd>
      </dl>
      <p className="mt-2">The fingerprint is worked out from the contract exactly as it was shown when signing. Any change to the wording would change it.</p>
    </section>
  );
}
