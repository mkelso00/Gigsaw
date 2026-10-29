import type { Metadata } from "next";
import { createStaffUser, removeStaffUser } from "@/actions/settings";
import { ActionForm, ConfirmButton, SubmitButton } from "@/components/forms";
import { Badge, SettingsCard, SettingsPage, SettingsRow, SettingsSection } from "@/components/settings-ui";
import { Field } from "@/components/ui";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Internal users" };

export default async function UsersSettings() {
  const user = await requireAdmin();
  const agency = user.agency!;
  const team = await prisma.user.findMany({
    where: { agencyId: user.agencyId, role: { in: ["ADMIN", "AGENT"] }, demo: false },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  const extra = Math.max(0, team.length - agency.includedUsers);
  return (
    <SettingsPage title="Internal users">
      <SettingsSection
        title={`${team.length} internal user${team.length === 1 ? "" : "s"}`}
        description={
          <>
            You and your staff who log in to make bookings. Whoever makes a booking is its lead agent. Your plan includes {agency.includedUsers}
            {agency.extraUserYearlyMinor > 0 ? `; each extra one is ${formatMoney(agency.extraUserYearlyMinor, agency.billingCurrency)} a year` : ""}
            {extra ? ` (${extra} extra now)` : ""}. Acts, venue managers and customers are external users and are free.
          </>
        }
      >
        <SettingsCard>
          {team.map((u) => (
            <SettingsRow
              key={u.id}
              icon="user"
              title={u.name}
              sub={`${u.email}${u.phone ? ` · ${u.phone}` : " · no mobile"}`}
              right={
                <span className="flex items-center gap-2">
                  <Badge tone={u.role === "ADMIN" ? "green" : "grey"}>{u.role === "ADMIN" ? "Admin" : "Agent"}</Badge>
                  {u.id !== user.id && !u.isOwner && (
                    <form action={removeStaffUser.bind(null, u.id)}>
                      <ConfirmButton message={`Remove ${u.name}'s access?`} className="btn btn-sm">
                        Remove
                      </ConfirmButton>
                    </form>
                  )}
                </span>
              }
            />
          ))}
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Add an internal user" description="Admins can change settings and manage users. Agents can do everything else.">
        <SettingsCard pad>
          <ActionForm action={createStaffUser} className="grid gap-4 sm:grid-cols-2">
            <Field label="Name">
              <input name="name" required className="input" />
            </Field>
            <Field label="Email">
              <input name="email" type="email" required className="input" />
            </Field>
            <Field label="Mobile" hint="Optional. Used for texts about late acts on their gigs.">
              <input name="phone" type="tel" className="input" />
            </Field>
            <Field label="Password" hint="At least 8 characters. Send it to them; they can change it in their profile.">
              <input name="password" type="text" minLength={8} required className="input" autoComplete="new-password" />
            </Field>
            <Field label="Role" hint="Admins can also change settings and users">
              <select name="role" className="input">
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Admin</option>
              </select>
            </Field>
            <div className="flex justify-end border-t border-ink-100 pt-4 sm:col-span-2">
              <SubmitButton pendingText="Adding…">Add user</SubmitButton>
            </div>
          </ActionForm>
        </SettingsCard>
      </SettingsSection>
      <p className="text-sm text-ink-500">Logins for acts are made on each act&apos;s page, or when you approve a new act.</p>
    </SettingsPage>
  );
}
