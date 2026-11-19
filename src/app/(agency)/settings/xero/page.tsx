import type { Metadata } from "next";
import { chooseXeroOrganisation, disconnectXeroAction, saveXeroSettings, testXeroConnection } from "@/actions/xero";
import { CopyField } from "@/components/client-bits";
import { ActionForm, ConfirmButton, ServerForm, SubmitButton } from "@/components/forms";
import { Badge, SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { getSettings, prisma } from "@/lib/db";
import { appUrl } from "@/lib/messaging";
import { formatDate } from "@/lib/time";
import { savedTenants, UK_SALES_TAX_TYPES, xeroConnectMessage, xeroRedirectUri, xeroSetup } from "@/lib/xero";

export const metadata: Metadata = { title: "Xero" };
export const dynamic = "force-dynamic";

// Settings > Xero: connect the business's Xero organisation, so each month's invoices to venues and companies are
// made there as drafts, and choose the sales account and tax rate they use. Xero needs the business's own free
// app from developer.xero.com, set in Railway (XERO_CLIENT_ID and XERO_CLIENT_SECRET); until then this page says
// what to do instead of offering Connect.

export default async function XeroSettings({ searchParams }: { searchParams: Promise<{ xero?: string }> }) {
  const user = await requireAdmin();
  const sp = await searchParams;
  const setup = xeroSetup();
  const redirectUri = xeroRedirectUri(appUrl());
  const conn = await prisma.xeroConnection.findUnique({ where: { agencyId: user.agencyId }, include: { connectedBy: { select: { name: true } } } });
  const connected = !!(conn?.refreshTokenEnc && conn.tenantId);
  const message = xeroConnectMessage(sp.xero, conn?.tenantName);
  const tenants = conn && connected ? savedTenants(conn) : [];
  const timeZone = (await getSettings(user.agencyId)).defaultTimezone;
  const taxTypes =
    conn && !UK_SALES_TAX_TYPES.some((t) => t.value === conn.taxType)
      ? [...UK_SALES_TAX_TYPES, { value: conn.taxType, label: conn.taxType }]
      : UK_SALES_TAX_TYPES;

  return (
    <SettingsPage title="Xero">
      {message && (
        <div
          role={message.tone === "error" ? "alert" : "status"}
          className={`rounded-xl border px-4 py-3 text-sm ${message.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}
        >
          {message.text}
        </div>
      )}

      <SettingsSection
        title="Connection"
        description="Send each month's invoices to venues and companies straight to your Xero, as drafts for you to check and approve there. Gigsaw then shows which ones have been paid."
      >
        <SettingsCard>
          {connected && conn ? (
            <>
              <SettingsRow
                icon="company"
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {conn.tenantName || "Xero organisation"}
                    <Badge tone={conn.needsReconnect ? "red" : "green"}>{conn.needsReconnect ? "Needs connecting again" : "Connected"}</Badge>
                  </span>
                }
                sub={
                  conn.needsReconnect
                    ? conn.lastError || "Xero stopped accepting Gigsaw's access. Connect again to carry on sending invoices."
                    : `Connected${conn.connectedBy ? ` by ${conn.connectedBy.name}` : ""}${conn.connectedAt ? ` on ${formatDate(conn.connectedAt, timeZone)}` : ""}.`
                }
                right={
                  setup === "ready" ? (
                    <a href="/api/xero/connect" className={`btn btn-sm ${conn.needsReconnect ? "btn-primary" : ""}`}>
                      {conn.needsReconnect ? "Connect again" : "Reconnect"}
                    </a>
                  ) : undefined
                }
              />
              {setup !== "ready" && (
                <SettingsRow
                  icon="lock"
                  title="Xero's settings are missing"
                  sub="XERO_CLIENT_ID, XERO_CLIENT_SECRET or the token key has been taken out of Railway, so Gigsaw can't reach Xero. Put them back, or disconnect below."
                />
              )}
              {tenants.length > 1 && (
                <div className="px-5 py-4">
                  <ActionForm action={chooseXeroOrganisation}>
                    <div className="flex flex-wrap items-end gap-3">
                      <Field label="Organisation invoices go to" hint="You allowed more than one when connecting." className="min-w-[240px] flex-1">
                        <select name="tenantId" defaultValue={conn.tenantId} className="input">
                          {tenants.map((t) => (
                            <option key={t.tenantId} value={t.tenantId}>
                              {t.tenantName}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <SubmitButton className="btn btn-sm" pendingText="Changing…">
                        Use this one
                      </SubmitButton>
                    </div>
                  </ActionForm>
                </div>
              )}
              {setup === "ready" && (
                <div className="px-5 py-4">
                  <ActionForm action={testXeroConnection}>
                    <div className="flex flex-wrap items-center gap-3">
                      <SubmitButton className="btn btn-sm" pendingText="Asking Xero…">
                        Test the connection
                      </SubmitButton>
                      <span className="text-sm text-ink-500">Asks Xero for your organisation&apos;s details. Nothing is changed.</span>
                    </div>
                  </ActionForm>
                </div>
              )}
            </>
          ) : setup === "ready" ? (
            <SettingsRow
              icon="company"
              title="Not connected"
              sub="Sign in to Xero and choose your organisation. Gigsaw only asks to add contacts and invoices and to read them back."
              right={
                <a href="/api/xero/connect" className="btn btn-primary btn-sm">
                  Connect Xero
                </a>
              }
            />
          ) : setup === "no_key" ? (
            <SettingsRow
              icon="lock"
              title="Almost set up"
              sub="Xero's client ID and secret are in Railway, but there's no key to keep Xero's tokens safe. Add XERO_TOKEN_KEY in Railway (see below), and Connect will show here."
            />
          ) : (
            <SettingsRow
              icon="lock"
              title="Xero isn't set up yet"
              sub="Before you can connect, Xero needs a free app made for your business and two settings in Railway: XERO_CLIENT_ID and XERO_CLIENT_SECRET. The steps are below."
            />
          )}
        </SettingsCard>
      </SettingsSection>

      {(setup === "ready" || connected) && (
        <SettingsSection
          title="Invoices"
          description="Every line is sent ex VAT (Gigsaw's prices are before VAT) and Xero adds the VAT for the tax rate. Invoices arrive in Xero as drafts with the customer's PO number as the reference."
        >
          <ActionForm action={saveXeroSettings} saveBar>
            <SettingsCard pad>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Sales account code" hint="From your chart of accounts in Xero. 200 is Sales in a new organisation.">
                  <input name="salesAccountCode" defaultValue={conn?.salesAccountCode ?? "200"} className="input" maxLength={10} required />
                </Field>
                <Field label="Tax rate" hint="20% VAT on income is OUTPUT2 in a UK organisation.">
                  <select name="taxType" defaultValue={conn?.taxType ?? "OUTPUT2"} className="input">
                    {taxTypes.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Days to pay" hint="Blank uses the payment terms set in Xero for the contact or organisation.">
                  <input name="dueDays" inputMode="numeric" defaultValue={conn?.dueDays ?? ""} placeholder="Xero's terms" className="input" />
                </Field>
              </div>
            </SettingsCard>
          </ActionForm>
        </SettingsSection>
      )}

      <SettingsSection
        id="setup"
        title="Setting up Xero"
        description="Done once, by whoever looks after your Gigsaw site on Railway. It's free and takes about ten minutes."
      >
        <SettingsCard pad>
          <ol className="list-decimal space-y-3 pl-5 text-sm text-ink-700">
            <li>
              Go to{" "}
              <a href="https://developer.xero.com/app/manage" target="_blank" rel="noreferrer" className="link">
                developer.xero.com
              </a>
              , sign in with your Xero login and choose <strong>New app</strong>. Making an app is free.
            </li>
            <li>
              Give it a name, like &quot;Gigsaw invoices&quot;, choose <strong>Web app</strong>, put your website as the company URL, and paste this as the
              redirect URI:
              <div className="mt-2 max-w-xl">
                <CopyField value={redirectUri} />
              </div>
            </li>
            <li>
              Once it&apos;s made, open <strong>Configuration</strong>. Copy the <strong>Client id</strong>, then press <strong>Generate a secret</strong> and
              copy that too. Xero only shows the secret once.
            </li>
            <li>
              In Railway, open your Gigsaw service, then <strong>Variables</strong>, and add <code className="font-mono text-xs">XERO_CLIENT_ID</code> and{" "}
              <code className="font-mono text-xs">XERO_CLIENT_SECRET</code> with those two values. If there&apos;s no{" "}
              <code className="font-mono text-xs">CALENDAR_TOKEN_KEY</code> there already, also add <code className="font-mono text-xs">XERO_TOKEN_KEY</code>{" "}
              with 32 random bytes in base64 (run <code className="font-mono text-xs">openssl rand -base64 32</code> to make one). Railway restarts Gigsaw with
              them.
            </li>
            <li>Come back to this page and press Connect Xero.</li>
          </ol>
        </SettingsCard>
      </SettingsSection>

      {connected && (
        <SettingsSection
          title="Disconnect"
          description="Stops sending invoices to Xero, and Xero takes back Gigsaw's access. Invoices already in Xero stay there, and the settings above are kept."
        >
          <SettingsCard pad>
            <ServerForm action={disconnectXeroAction}>
              <ConfirmButton message="Disconnect Xero? You can connect it again any time." className="btn btn-danger">
                Disconnect Xero
              </ConfirmButton>
            </ServerForm>
          </SettingsCard>
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
