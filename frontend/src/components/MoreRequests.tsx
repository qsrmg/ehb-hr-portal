"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";

const ITEMS = [
  { href: "/requests/new/letter", label: "Request a letter" },
  { href: "/requests/new/expense", label: "Claim expenses" },
  { href: "/requests/new/travel", label: "Request travel" },
  { href: "/requests/new/asset", label: "Request an asset" },
  { href: "/requests", label: "All my requests" },
];

/** The dashboard's less common requests, in a menu next to the three main actions. */
export function MoreRequests({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        ref={button}
        type="button"
        className={`${className} gap-1.5`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="more-requests"
        onClick={() => setOpen((v) => !v)}
      >
        More requests
        <svg viewBox="0 0 20 20" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 8l5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div
          id="more-requests"
          role="menu"
          aria-label="More requests"
          className="absolute left-0 top-full z-20 mt-2 w-56 overflow-hidden rounded-xl border border-white/10 bg-ink-900 py-1 shadow-[0_20px_50px_-15px_rgba(0,0,0,.8)]"
        >
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center justify-between px-4 py-2.5 text-sm font-semibold text-white/85 hover:bg-white/5 hover:text-white focus-visible:bg-white/10 focus-visible:outline-none"
            >
              {item.label}
              <Icon name="arrowRight" className="h-3.5 w-3.5 text-white/40" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
