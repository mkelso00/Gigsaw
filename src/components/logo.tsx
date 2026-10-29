/** The Gigsaw mark (a jigsaw piece) and wordmark. */
export function Logo({ tone = "dark", size = 28, sub }: { tone?: "dark" | "light"; size?: number; sub?: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
        <rect width="64" height="64" rx="16" fill={tone === "light" ? "#0d0d0c" : "#cdf72e"} />
        <path
          d="M17 17h12.5a5.5 5.5 0 1 1 9 0H47v12.5a5.5 5.5 0 1 0 0 9V47H34.5a5.5 5.5 0 1 1-9 0H17z"
          fill={tone === "light" ? "#cdf72e" : "#0d0d0c"}
        />
      </svg>
      <span className="leading-none">
        <span className={`block text-[17px] font-semibold tracking-tight ${tone === "dark" ? "text-white" : "text-ink-950"}`}>gigsaw</span>
        {sub && <span className={`mt-1 block max-w-40 truncate text-xs ${tone === "dark" ? "text-ink-400" : "text-ink-500"}`}>{sub}</span>}
      </span>
    </span>
  );
}
