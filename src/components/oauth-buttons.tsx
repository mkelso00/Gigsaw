import { oauthMessage, parseProvider, PROVIDERS, type OAuthIntent, type ProviderKey } from "@/lib/oauth";

export function ProviderLogo({ provider, className = "h-[18px] w-[18px]" }: { provider: ProviderKey; className?: string }) {
  if (provider === "google")
    return (
      <svg viewBox="0 0 48 48" className={className} aria-hidden>
        <path
          fill="#FFC107"
          d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.4-.4-3.5z"
        />
        <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
        <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
        <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.2-.1-2.4-.4-3.5z" />
      </svg>
    );
  return (
    <svg viewBox="0 0 21 21" className={className} aria-hidden>
      <path fill="#F25022" d="M1 1h9v9H1z" />
      <path fill="#7FBA00" d="M11 1h9v9h-9z" />
      <path fill="#00A4EF" d="M1 11h9v9H1z" />
      <path fill="#FFB900" d="M11 11h9v9h-9z" />
    </svg>
  );
}

/** "Sign in with Google" and "Sign in with Microsoft", for whichever are set up on this site. */
export function OAuthButtons({ providers, intent, verb }: { providers: ProviderKey[]; intent: OAuthIntent; verb: string }) {
  if (!providers.length) return null;
  return (
    <div className="space-y-2.5">
      {providers.map((p) => (
        // A plain link: the server sends the browser on to Google or Microsoft.
        <a key={p} href={`/api/auth/${p}?intent=${intent}`} className="btn h-11 w-full gap-2.5" data-provider={p}>
          <ProviderLogo provider={p} />
          {verb} with {PROVIDERS[p].label}
        </a>
      ))}
      <div className="flex items-center gap-3 py-2 text-xs text-ink-400">
        <span className="h-px flex-1 bg-ink-200" />
        or with your email
        <span className="h-px flex-1 bg-ink-200" />
      </div>
    </div>
  );
}

/** The message after coming back from Google or Microsoft (?oauth=…&p=…). */
export function OAuthNotice({ sp, className = "mb-5" }: { sp: { oauth?: string; p?: string; email?: string }; className?: string }) {
  const msg = oauthMessage(sp.oauth, parseProvider(sp.p), sp.email);
  if (!msg) return null;
  return (
    <div
      role={msg.tone === "error" ? "alert" : "status"}
      className={`${className} rounded-lg border px-3 py-2 text-sm ${msg.tone === "error" ? "border-rose-200 bg-rose-50 text-rose-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}
    >
      {msg.text}
      {sp.oauth === "no_account" && (
        <>
          {" "}
          <a href="/signup" className="font-medium underline">
            Start a free trial
          </a>
        </>
      )}
    </div>
  );
}
