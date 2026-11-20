/**
 * On an act's invoice made while its payee had no current self-billing agreement (src/lib/self-billing.ts). The
 * invoice still stands and is paid as usual; the act is asked to agree in the weekly reminder.
 */
export function NoAgreement() {
  return (
    <span
      className="ml-1 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800"
      title="Made while they had no current self-billing agreement. It's still paid as usual; they're asked to agree in the app."
      data-testid="no-agreement"
    >
      No self-billing agreement
    </span>
  );
}
