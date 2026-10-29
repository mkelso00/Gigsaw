import { logout } from "@/actions/auth";
import { AuthShell } from "@/components/auth-shell";

export default function SuspendedPage() {
  return (
    <AuthShell title="This account is paused" subtitle="Your agency's Gigsaw account has been suspended. Your data is safe. Get in touch with Gigsaw to reactivate it.">
      <form action={logout}>
        <button className="btn h-11 w-full">Sign out</button>
      </form>
    </AuthShell>
  );
}
