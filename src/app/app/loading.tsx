/** Shown straight away while an act app page loads: the same quiet shapes as the main app, on its dark background. */
export default function Loading() {
  // .skeleton paints light grey, so the colour is set here for the dark app.
  const dark = { background: "var(--color-ink-900)" };
  return (
    <div aria-busy="true" aria-label="Loading" className="motion-page-in">
      <div className="skeleton h-3 w-24" style={dark} />
      <div className="mt-3 space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="skeleton h-24" style={{ ...dark, animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
      <div className="skeleton mt-8 h-3 w-32" style={dark} />
      <div className="mt-3 space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-14" style={{ ...dark, animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}
