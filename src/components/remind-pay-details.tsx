import { remindPayDetailsNow } from "@/actions/pay-details-chase";
import { ActionForm, SubmitButton } from "@/components/forms";

/**
 * "Remind now" for one act on Pay acts' "Waiting for details" list: sends the act's payee the pay details reminder
 * straight away (src/lib/pay-details-chase.ts) instead of waiting for Monday's.
 */
export function RemindPayDetails({ artistId }: { artistId: string }) {
  return (
    <ActionForm action={remindPayDetailsNow.bind(null, artistId)} className="flex flex-wrap items-center gap-2 [&_[role=status]]:text-xs">
      <SubmitButton className="btn btn-sm" pendingText="Sending…">
        Remind now
      </SubmitButton>
    </ActionForm>
  );
}
