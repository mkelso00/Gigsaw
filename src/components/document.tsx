import type { Settings } from "@prisma/client";
import { PrintButton } from "@/components/client-bits";

export function DocumentShell({ title, reference, settings, children }: { title: string; reference: string; settings: Settings; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
      <div className="no-print mx-auto mb-4 flex max-w-3xl justify-end px-4">
        <PrintButton />
      </div>
      <article className="mx-auto max-w-3xl bg-white p-10 text-[15px] leading-relaxed shadow print:max-w-none print:p-0 print:shadow-none">
        <header className="mb-8 flex items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <div className="text-2xl font-bold">{settings.agencyName}</div>
            <div className="text-sm whitespace-pre-line text-slate-500">
              {settings.agencyAddress}
              {settings.agencyEmail ? `\n${settings.agencyEmail}` : ""}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xl font-semibold tracking-wide text-brand-700 uppercase">{title}</div>
            <div className="text-sm text-slate-500">{reference}</div>
          </div>
        </header>
        {children}
      </article>
    </div>
  );
}

export function DocTable({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows
          .filter(([, v]) => v !== "" && v !== null && v !== undefined)
          .map(([k, v]) => (
            <tr key={k} className="border-b border-slate-100">
              <th className="w-48 py-2 pr-4 text-left align-top font-medium text-slate-500">{k}</th>
              <td className="py-2 whitespace-pre-line">{v}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}
