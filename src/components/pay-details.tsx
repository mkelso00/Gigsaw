import { saveMyDetails } from "@/actions/act-details";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Reveal } from "@/components/reveal";
import { Field } from "@/components/ui";
import { maskAccount, maskNi, missingDetails, NI_HINT, type PayFields } from "@/lib/act-details";

// Pay details (bank, address, National Insurance number, VAT): the act's own form in the act app,
// and the fields on an admin's edit form. The card on the staff act page is in pay-details-card.tsx.
// Who may see what is in src/lib/act-details.ts: the act themself and the agency's admins only.

const darkField =
  "block w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 text-base text-white [color-scheme:dark] placeholder:text-ink-500 focus:border-volt-400/60 focus:outline-none";
const darkLabel = "mb-1.5 block text-[13px] font-medium text-ink-300";
const darkHint = "mt-1.5 block text-xs leading-relaxed text-ink-400";

/** Whose details they are: a person's own, or an act's (an act's own login with nobody on file). */
type Holder = PayFields & { kind: "act" | "person"; id: string; name: string; detailsCompletedAt: Date | null };

const hasBank = (a: PayFields) => !!(a.bankAccountName && a.bankSortCode && a.bankAccountNumber);

/** The form in the act app (Your details). Numbers already on file are masked, with Change. */
export function ActDetailsForm({ holder: act, showName }: { holder: Holder; showName: boolean }) {
  const first = !act.detailsCompletedAt;
  const missing = missingDetails(act);
  const bankInputs = (
    <div className="space-y-3">
      <label className="block">
        <span className={darkLabel}>Name on the account</span>
        <input name="bankAccountName" required autoComplete="name" maxLength={120} className={`${darkField} h-11`} />
      </label>
      <div className="grid grid-cols-[2fr_3fr] gap-2">
        <label className="block">
          <span className={darkLabel}>Sort code</span>
          <input name="bankSortCode" required inputMode="numeric" placeholder="12-34-56" maxLength={8} className={`${darkField} h-11 tabular-nums`} />
        </label>
        <label className="block">
          <span className={darkLabel}>Account number</span>
          <input name="bankAccountNumber" required inputMode="numeric" placeholder="12345678" maxLength={10} className={`${darkField} h-11 tabular-nums`} />
        </label>
      </div>
    </div>
  );
  const niInput = (
    <label className="block">
      <span className={darkLabel}>National Insurance number (optional)</span>
      <input
        name="niNumber"
        autoCapitalize="characters"
        autoComplete="off"
        placeholder="QQ 12 34 56 C"
        maxLength={13}
        className={`${darkField} h-11 uppercase tabular-nums`}
      />
      <span className={darkHint}>{NI_HINT}</span>
    </label>
  );
  return (
    <section className="rounded-2xl border border-white/[0.06] bg-ink-900 p-5">
      {showName && <h2 className="mb-1 text-lg font-semibold">{act.name}</h2>}
      {missing.length > 0 && <p className="mb-4 text-sm text-volt-400">Still needed: {missing.join(", ")}.</p>}
      <ActionForm action={saveMyDetails.bind(null, act.kind, act.id)} className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium text-volt-400">Bank account</legend>
          {hasBank(act) ? (
            <Reveal
              dark
              summary={
                <span className="block text-[15px]">
                  {act.bankAccountName}
                  <span className="block text-sm text-ink-400">
                    {act.bankSortCode} · {maskAccount(act.bankAccountNumber)}
                  </span>
                </span>
              }
            >
              {bankInputs}
            </Reveal>
          ) : (
            bankInputs
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium text-volt-400">About you</legend>
          <label className="block">
            <span className={darkLabel}>Postal address</span>
            <textarea
              name="address"
              required
              rows={4}
              autoComplete="street-address"
              defaultValue={act.address}
              className={`${darkField} py-2.5 leading-relaxed`}
            />
          </label>
          {act.niNumber ? (
            <div>
              <span className={darkLabel}>National Insurance number</span>
              <Reveal dark summary={<span className="text-[15px]">{maskNi(act.niNumber)}</span>}>
                {niInput}
              </Reveal>
              <span className={darkHint}>{NI_HINT}</span>
            </div>
          ) : (
            niInput
          )}
          {!act.phone && (
            <label className="block">
              <span className={darkLabel}>Mobile number</span>
              <input name="phone" type="tel" autoComplete="tel" className={`${darkField} h-11`} />
              <span className={darkHint}>For reminders on the day of a booking.</span>
            </label>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-3 text-sm font-medium text-volt-400">VAT (only if you&apos;re registered)</legend>
          <label className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-[15px]">
            <input type="checkbox" name="vatRegistered" defaultChecked={act.vatRegistered} className="h-4 w-4 accent-volt-400" />
            I&apos;m VAT registered
          </label>
          <label className="block">
            <span className={darkLabel}>VAT number</span>
            <input name="vatNumber" defaultValue={act.vatNumber} placeholder="GB 123 4567 89" className={`${darkField} h-11 tabular-nums`} />
          </label>
        </fieldset>

        <SubmitButton className="h-12 w-full rounded-xl bg-volt-400 text-[15px] font-medium text-ink-950 hover:bg-volt-300 disabled:opacity-50">
          {first ? "Save and see my bookings" : "Save changes"}
        </SubmitButton>
      </ActionForm>
    </section>
  );
}

/** The pay fields on the act's edit page. Admins only: agents don't get these fields at all. */
export function StaffPayFields({
  artist,
  intro = "For paying the act and their self-billing invoices. Only admins and the act can see these.",
  withAddress = true,
}: {
  artist?: PayFields;
  intro?: string;
  /** False on a person's page, where the address is in the main form. */
  withAddress?: boolean;
}) {
  const niInput = (
    <input name="niNumber" autoComplete="off" placeholder="QQ 12 34 56 C" className="input uppercase" defaultValue="" aria-label="National Insurance number" />
  );
  return (
    <>
      <h3 className="pt-2 text-sm font-semibold">Pay details</h3>
      <p className="-mt-2 text-xs text-ink-500">{intro}</p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name on the account">
          <input name="bankAccountName" defaultValue={artist?.bankAccountName} className="input" />
        </Field>
        <Field label="Sort code">
          <input name="bankSortCode" defaultValue={artist?.bankSortCode} placeholder="12-34-56" inputMode="numeric" className="input" />
        </Field>
        <Field label="Account number">
          <input name="bankAccountNumber" defaultValue={artist?.bankAccountNumber} placeholder="12345678" inputMode="numeric" className="input" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {withAddress && (
          <Field label="Postal address">
            <textarea name="address" rows={3} defaultValue={artist?.address} className="input" />
          </Field>
        )}
        <div className="space-y-4">
          <div className="block">
            <span className="label">National Insurance number</span>
            {artist?.niNumber ? <Reveal summary={maskNi(artist.niNumber)}>{niInput}</Reveal> : niInput}
            <span className="hint block">For the agency&apos;s records only.</span>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-end gap-4">
            <label className="flex h-11 items-center gap-3">
              <input type="checkbox" name="vatRegistered" defaultChecked={artist?.vatRegistered} className="h-4 w-4 accent-ink-950" />
              <span className="text-sm font-medium">VAT registered</span>
            </label>
            <Field label="VAT number">
              <input name="vatNumber" defaultValue={artist?.vatNumber} className="input" />
            </Field>
          </div>
        </div>
      </div>
    </>
  );
}
