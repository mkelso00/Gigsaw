/** Shown straight away while a page loads, so every click answers at once. Quiet grey shapes, softly breathing. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="motion-page-in">
      <div className="skeleton h-3 w-28" />
      <div className="skeleton mt-3 h-8 w-64" />
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-24" style={{ animationDelay: `${i * 120}ms` }} />
        ))}
      </div>
      <div className="mt-6 space-y-2">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="skeleton h-14" style={{ animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  );
}
