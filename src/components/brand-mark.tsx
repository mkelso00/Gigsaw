"use client";

import { useEffect, useRef, useState } from "react";

/** A business's logo on a customer page, or its name if there's no logo or the image won't load. */
export function BrandMark({ src, name, className = "h-10 max-w-[160px] object-contain" }: { src: string | null; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // An image that failed before the page came to life never fires onError: check it once it has.
  useEffect(() => {
    const i = img.current;
    if (i && i.complete && i.naturalWidth === 0) setFailed(true);
  }, [src]);
  if (!src || failed) return <span className="text-[15px] font-semibold tracking-tight">{name}</span>;
  // A logo of any size from the business: a plain img keeps it simple.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={img} src={src} alt={name} className={className} onError={() => setFailed(true)} />;
}
