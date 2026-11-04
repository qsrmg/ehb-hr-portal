"use client";

import { useEffect, useRef, useState } from "react";

/** The EHB logo on its white tile: public/ehb-logo.png, or a lettered placeholder until that file exists. */
export function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const [missing, setMissing] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // An image that failed before hydration never fires onError, so check once after mounting.
  useEffect(() => {
    const el = img.current;
    if (el && el.complete && el.naturalWidth === 0) setMissing(true);
  }, []);
  const box = { sm: "h-9 w-[74px]", md: "h-11 w-[90px]", lg: "h-[60px] w-[132px]" }[size];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white px-2 ${box}`}>
      {missing ? (
        <span className="font-display text-lg font-extrabold leading-none tracking-tight text-ink-950" aria-label="EHB">
          E<span className="text-sun">H</span>B
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src="/ehb-logo.png" alt="EHB" className="max-h-full max-w-full object-contain" onError={() => setMissing(true)} />
      )}
    </span>
  );
}
