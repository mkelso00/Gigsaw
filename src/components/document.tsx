import { PrintButton } from "@/components/client-bits";

type Letterhead = { agencyName: string; agencyAddress: string; agencyEmail: string };

/**
 * A printable document on the agency's letterhead. `toolbar` replaces the print button above it
 * (pass null for none); `after` goes below the page, e.g. the signing form.
 */
export function DocumentShell({
  title,
  reference,
  settings,
  children,
  toolbar,
  after,
}: {
  title: string;
  reference: string;
  settings: Letterhead;
  children: React.ReactNode;
  toolbar?: React.ReactNode;
  after?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-100 py-4 sm:py-8 print:bg-white print:py-0">
      {toolbar !== null && <div className="no-print mx-auto mb-4 flex max-w-3xl flex-wrap justify-end gap-2 px-4">{toolbar ?? <PrintButton />}</div>}
      <article className="mx-auto max-w-3xl bg-white p-5 text-[15px] leading-relaxed shadow sm:p-10 print:max-w-none print:p-0 print:shadow-none">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-x-6 gap-y-3 border-b border-slate-200 pb-6">
          <div>
            <div className="text-2xl font-bold">{settings.agencyName}</div>
            <div className="text-sm whitespace-pre-line text-slate-500">
              {settings.agencyAddress}
              {settings.agencyEmail ? `\n${settings.agencyEmail}` : ""}
            </div>
          </div>
          <div className="sm:text-right">
            <div className="text-xl font-semibold tracking-wide text-brand-700 uppercase">{title}</div>
            <div className="text-sm text-slate-500">{reference}</div>
          </div>
        </header>
        {children}
      </article>
      {after}
    </div>
  );
}

export function DocTable({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows
          .filter(([, v]) => v !== "" && v !== null && v !== undefined)
          .map(([k, v], i) => (
            <tr key={`${k}-${i}`} className="border-b border-slate-100">
              <th className="w-32 py-2 pr-4 text-left align-top font-medium text-slate-500 sm:w-48">{k}</th>
              <td className="py-2 break-words whitespace-pre-line">{v}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
