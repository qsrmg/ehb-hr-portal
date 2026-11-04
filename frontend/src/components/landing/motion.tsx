"use client";

import { useEffect, useRef, useState } from "react";

/** Calls `onVisible` once, when the element first scrolls into view (straight away without IntersectionObserver). */
function useOnVisible<T extends Element>(onVisible: () => void, rootMargin = "0px 0px -10% 0px") {
  const ref = useRef<T>(null);
  const callback = useRef(onVisible);
  useEffect(() => {
    callback.current = onVisible;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      callback.current();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          callback.current();
        }
      },
      { rootMargin, threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return ref;
}

type RevealTag = "div" | "section" | "li" | "ol" | "ul" | "article";

/**
 * Fades its content up when it scrolls into view (see [data-reveal] in globals.css). `index` staggers siblings.
 * Children with .grow-x / .grow-y (bars, connectors) grow once it is visible.
 */
export function Reveal({
  as: Tag = "div", index = 0, className, children, ...rest
}: { as?: RevealTag; index?: number; className?: string; children: React.ReactNode } & React.HTMLAttributes<HTMLElement>) {
  const [visible, setVisible] = useState(false);
  const ref = useOnVisible<HTMLElement>(() => setVisible(true));
  return (
    <Tag
      ref={ref as React.Ref<never>}
      data-reveal=""
      data-visible={visible ? "" : undefined}
      className={className}
      style={{ "--i": index } as React.CSSProperties}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/**
 * A number that counts up from zero when it scrolls into view. The server renders the final value, so it is
 * correct without JavaScript and for people who prefer reduced motion.
 */
export function CountUp({ value, duration = 1200, className }: { value: number; duration?: number; className?: string }) {
  const [shown, setShown] = useState(value);
  const ref = useOnVisible<HTMLSpanElement>(() => {
    if (value === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, "0px");
  return (
    <span ref={ref} className={className}>
      {shown}
    </span>
  );
}
