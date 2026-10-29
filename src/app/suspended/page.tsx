import { logout } from "@/actions/auth";

export default function SuspendedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="card max-w-md p-6 text-center">
        <h1 className="text-lg font-semibold">This account is paused</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your agency&apos;s Gigsaw account has been suspended. Your data is safe. Please get in touch with Gigsaw to reactivate it.
        </p>
        <form action={logout} className="mt-5">
          <button className="btn">Sign out</button>
        </form>
      </div>
    </main>
  );
}
