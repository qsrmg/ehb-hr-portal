"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { Logo } from "@/components/brand";

export const SECTIONS = [
  { id: "features", label: "Features" },
  { id: "how-it-works", label: "How It Works" },
  { id: "benefits", label: "Employee Benefits" },
  { id: "security", label: "Security" },
] as const;

/**
 * Transparent over the hero, translucent with a blur once the page scrolls. The link of the section in view
 * is underlined; on phones the links move into a menu.
 */
export function LandingHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById(s.id);
      if (el) io.observe(el);
    }
    const hero = document.getElementById("top");
    const heroIo = new IntersectionObserver(([e]) => e?.isIntersecting && setActive(null), { rootMargin: "-45% 0px -50% 0px" });
    if (hero) heroIo.observe(hero);
    return () => {
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
      heroIo.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-[background-color,border-color,box-shadow] duration-300 ${
        scrolled || open ? "border-b border-white/10 bg-ink-950/80 shadow-[0_10px_30px_-20px_rgba(0,0,0,.8)] backdrop-blur-md" : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sun" aria-label="EHB HR Self-Service Portal, home">
          <Logo />
          <span className="hidden border-l border-white/15 pl-3 text-sm font-bold leading-tight text-white sm:block">
            HR Self-Service
            <br />
            <span className="font-semibold text-haze">Portal</span>
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={active === s.id ? "true" : undefined}
              className="group relative rounded-md px-3.5 py-2 text-sm font-semibold text-white/80 transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-sun"
            >
              {s.label}
              <span
                aria-hidden="true"
                className={`absolute inset-x-3.5 -bottom-0.5 h-0.5 origin-left rounded-full bg-sun transition-transform duration-300 ${active === s.id ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100 group-hover:bg-white/50"}`}
              />
            </a>
          ))}
        </nav>

        <Link
          href="/login"
          className="group ml-auto inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white shadow-[0_8px_24px_-8px_rgba(37,99,235,.9)] transition hover:-translate-y-px hover:bg-primary-hover hover:shadow-[0_12px_28px_-8px_rgba(37,99,235,1)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sun lg:ml-4"
        >
          Sign In
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="landing-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-white/85 ring-1 ring-white/15 transition hover:bg-white/10 lg:hidden"
        >
          {open ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
        </button>
      </div>

      <div
        id="landing-menu"
        className={`grid overflow-hidden transition-[grid-template-rows] duration-300 lg:hidden ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
        inert={!open}
      >
        <nav className="min-h-0 px-4 pb-4 sm:px-6" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={() => setOpen(false)}
              className="flex items-center justify-between border-b border-white/10 py-3.5 text-base font-semibold text-white/90 last:border-0"
            >
              {s.label}
              <ArrowRight className="h-4 w-4 text-white/40" aria-hidden="true" />
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
