import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/actions/auth";
import { AuthShell } from "@/components/auth-shell";
import { homePath, requireUser } from "@/lib/auth";
import { isLocked, lockedPath } from "@/lib/billing-lock";
import { billingState } from "@/lib/subscription";
import { ServerForm } from "@/components/forms";

export const metadata: Metadata = { title: "Choose a plan" };
export const dynamic = "force-dynamic";

// Where agents and acts land when their business's trial has ended or its subscription was
// cancelled (admins go to Settings, Plan instead, where they can sort it out).
export default async function LockedPage() {
  const user = await requireUser(undefined, { allowLocked: true });
  if (!isLocked(user)) redirect(homePath(user));
  if (lockedPath(user) !== "/locked") redirect(lockedPath(user));
  const act = user.role === "ARTIST";
  const name = user.agency!.name;
  return (
    <AuthShell
      title={act ? "The act app is paused" : billingState(user.agency!).label}
      subtitle={
        act
          ? `${name}'s Gigsaw account needs a plan before the act app opens again. Your bookings are safe.`
          : "Ask an admin at your business to choose a plan. Everything you've set up is safe, and it all opens again as soon as they do."
      }
    >
      <div className="space-y-3">
        {!act && (
          <Link href="/profile" className="btn h-11 w-full">
            Your profile
          </Link>
        )}
        <ServerForm action={logout}>
          <button className="btn h-11 w-full">Sign out</button>
        </ServerForm>
      </div>
    </AuthShell>
  );
}
