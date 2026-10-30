import Link from "next/link";
import { cancelContract, sendContractToSign } from "@/actions/contracts";
import { CopyField } from "@/components/client-bits";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { contractState, contractStatusLabel } from "@/lib/contract-doc";
import { contractUrl, type contractStatusFor } from "@/lib/contracts";
import { formatDate } from "@/lib/time";

// "Contract" card on a booking or a wedding or event: status, send to sign, resend, cancel, and
// the signed copy. A booking that's part of a wedding shows the wedding's contract instead.

type Status = Awaited<ReturnType<typeof contractStatusFor>>;

const TONE: Record<string, string> = {
  NONE: "bg-ink-100 text-ink-700",
  SENT: "bg-sky-50 text-sky-800",
  VIEWED: "bg-amber-50 text-amber-900",
  SIGNED: "bg-emerald-50 text-emerald-800",
};

export function ContractPanel({
  kind,
  id,
  status,
  timeZone,
  signer,
  previewHref,
  partOf,
  agencySigned = true,
}: {
  kind: "booking" | "event";
  id: string;
  status: Status;
  timeZone: string;
  /** Who to send it to by default: the payer, or the event's customer. */
  signer: { name: string; email: string } | null;
  previewHref: string;
  /** Set on a booking inside a wedding or event: its contract is the event's, managed there. */
  partOf?: { href: string; name: string };
  /** Whether the business has drawn its own signature (Settings → Contracts and invoices). */
  agencySigned?: boolean;
}) {
  const { current, changes, earlier } = status;
  const state = contractState(current);
  const open = current?.status === "SENT" ? current : null;
  const changed = state === "SIGNED" && changes.length > 0;
  // A resend or a new version goes to whoever it went to last, unless changed.
  const defaults = current ? { name: current.signerName, email: current.signerEmail } : (signer ?? { name: "", email: "" });

  const sendForm = (label: string) => (
    <ActionForm action={sendContractToSign.bind(null, kind, id)} className="mt-3 space-y-2">
      <label className="block">
        <span className="label">Who signs</span>
        <input name="signerName" required defaultValue={defaults.name} placeholder="Full name" className="input" autoComplete="off" />
      </label>
      <label className="block">
        <span className="label">Their email</span>
        <input name="signerEmail" type="email" required defaultValue={defaults.email} placeholder="name@example.com" className="input" autoComplete="off" />
      </label>
      <SubmitButton className="btn btn-primary w-full" pendingText="Sending…">
        {label}
      </SubmitButton>
    </ActionForm>
  );

  return (
    <section className="card card-pad">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="section-title">Contract</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${changed ? TONE.VIEWED : TONE[state]}`}>
          {state === "NONE" ? "Not sent" : state === "SENT" ? "Sent" : state === "VIEWED" ? "Viewed" : changed ? "Signed, now changed" : "Signed"}
        </span>
      </div>
      <p className="text-sm text-ink-700">{contractStatusLabel(current, timeZone)}</p>
      {current && state !== "SIGNED" && (
        <p className="text-xs text-ink-500">
          To {current.signerName} ({current.signerEmail}){current.viewedAt ? `, sent ${formatDate(current.sentAt, timeZone)}` : ""}
        </p>
      )}

      {changed && (
        <div role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
          <div className="font-semibold">Changed since signing, resend</div>
          <div className="mt-0.5">
            {changes.join(", ")} {changes.length === 1 ? "has" : "have"} changed since the client signed. Send the new version to sign.
          </div>
        </div>
      )}

      {partOf ? (
        <p className="mt-3 text-sm text-ink-600">
          This booking is part of{" "}
          <Link href={partOf.href} className="link">
            {partOf.name}
          </Link>
          . Its contract covers every act and is sent from there.
        </p>
      ) : (
        <>
          {state === "SIGNED" && current && (
            <div className="mt-3 flex flex-wrap gap-2">
              <a href={`/print/contracts/${current.id}`} target="_blank" className="btn btn-sm">
                Signed copy
              </a>
            </div>
          )}
          {open && (
            <div className="mt-3 space-y-2">
              <CopyField value={contractUrl(open.token)} />
            </div>
          )}
          {/* One form in one place, so its "Sent" message stays after the status changes. */}
          {state === "SIGNED" && !changed ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-ink-600">Send a fresh copy to sign</summary>
              {sendForm("Send a fresh copy to sign")}
            </details>
          ) : (
            sendForm(state === "NONE" ? "Send contract to sign" : open ? "Send again" : "Send the new version to sign")
          )}
          {open && (
            <form action={cancelContract.bind(null, open.id)} className="mt-2">
              <ConfirmButton message="Cancel this contract? The link stops working and it can't be signed." className="btn btn-sm w-full">
                Cancel the contract
              </ConfirmButton>
            </form>
          )}
          {!agencySigned && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Your side isn&apos;t signed yet: your name shows in a handwriting style.{" "}
              <a href="/settings/documents#signature" className="font-medium underline">
                Draw your signature
              </a>{" "}
              once and it goes on every contract.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a href={previewHref} target="_blank" className="link">
              {state === "SIGNED" ? "Print the current version" : "Preview the contract"}
            </a>
          </div>
        </>
      )}
      {state === "SIGNED" && partOf && current && (
        <a href={`/print/contracts/${current.id}`} target="_blank" className="btn btn-sm mt-3">
          Signed copy
        </a>
      )}
      {earlier.length > 0 && (
        <div className="mt-4 border-t border-ink-100 pt-3 text-xs text-ink-500">
          <div className="mb-1 font-medium text-ink-700">Signed before</div>
          <ul className="space-y-1">
            {earlier.map((c) => (
              <li key={c.id}>
                <a href={`/print/contracts/${c.id}`} target="_blank" className="link">
                  {c.signedName}, {c.signedAt ? formatDate(c.signedAt, timeZone) : ""}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {!partOf && !signer?.email && state === "NONE" && (
        <p className="hint">Tip: add an email address to the {kind === "event" ? "customer" : "client"} to fill this in for you.</p>
      )}
    </section>
  );
}
