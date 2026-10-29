import { Container } from "./site-ui";

/** Shared frame for the privacy and terms pages, with the draft warning at the top. */
export function LegalPage({ title, intro, children }: { title: string; intro: string; children: React.ReactNode }) {
  return (
    <Container className="py-14 sm:py-20">
      <div className="mx-auto max-w-2xl">
        <div role="note" className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-amber-900">
          <p className="font-semibold">Draft: to be checked before launch</p>
          <p className="mt-1 text-sm leading-relaxed">
            This page is a plain-English draft. It hasn&apos;t been reviewed by a lawyer yet and isn&apos;t legal advice. Details in square brackets are still
            to be filled in.
          </p>
        </div>
        <h1 className="mt-10 text-4xl leading-[1.02] font-semibold tracking-[-0.035em] sm:text-6xl">{title}</h1>
        <p className="mt-6 text-lg leading-relaxed text-ink-700">{intro}</p>
        <div className="mt-10 space-y-4 text-[17px] leading-relaxed text-ink-700 [&_h2]:pt-6 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-ink-950 [&_li]:pl-1 [&_strong]:font-semibold [&_strong]:text-ink-950 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6">
          {children}
        </div>
      </div>
    </Container>
  );
}
