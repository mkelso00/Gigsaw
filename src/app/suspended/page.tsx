import { logout } from "@/actions/auth";
import { AuthShell } from "@/components/auth-shell";
import { ServerForm } from "@/components/forms";

export default function SuspendedPage() {
  return (
    <AuthShell
      title="This account is paused"
      subtitle="Your business's Gigsaw account has been suspended. Your data is safe. Get in touch with Gigsaw to reactivate it."
    >
      <ServerForm action={logout}>
        <button className="btn h-11 w-full">Sign out</button>
      </ServerForm>
    </AuthShell>
  );
}
