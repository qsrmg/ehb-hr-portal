"use client";

import { motion } from "framer-motion";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Read synchronously (not via a hook) so the very first client render already has the right answer: with an
 * async hook (useState/useSyncExternalStore), React deliberately reuses the server's "no window" guess for
 * hydration safety, and by the time the real value arrives a tick later the mount animation has already
 * started — which is exactly the bug this avoids. The heading's `initial`/`animate` values are the only
 * thing that can differ from the server here (same text, same layout either way), so this is a safe,
 * deliberate mismatch; `suppressHydrationWarning` below silences the resulting (non-)warning accordingly. */
const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * "Welcome back to / your HR workspace." — a one-time, word-by-word 3D entrance: each word tilts and slides
 * up into place on its own delay, then the underline draws in. It plays once on mount and holds there:
 * `animate`'s target values are fixed constants, never derived from state, so Framer Motion has nothing to
 * re-animate towards on a later re-render (typing in the form, the 3D scene loading, the sign-in success
 * state, and so on all leave it untouched) — it only runs again if this component itself unmounted and
 * remounted, which nothing on this page does. Reduced motion renders the finished state immediately.
 */
export function WelcomeHeading() {
  const reduced = prefersReducedMotion();

  const word = (delay: number) => ({
    initial: reduced ? false : { opacity: 0, y: 22, rotateX: -40 },
    animate: { opacity: 1, y: 0, rotateX: 0 },
    transition: { delay, duration: 0.55, ease: EASE },
  });

  return (
    <h1
      className="mt-5 text-balance text-[2.25rem] font-extrabold leading-[1.06] tracking-[-0.02em] sm:text-5xl"
      style={{ perspective: 800 }}
    >
      <motion.span suppressHydrationWarning className="inline-block" style={{ transformOrigin: "50% 100%" }} {...word(0)}>
        Welcome
      </motion.span>{" "}
      <motion.span suppressHydrationWarning className="inline-block" style={{ transformOrigin: "50% 100%" }} {...word(0.4)}>
        back to
      </motion.span>
      <br />
      <motion.span suppressHydrationWarning className="inline-block" style={{ transformOrigin: "50% 100%" }} {...word(0.8)}>
        your
      </motion.span>{" "}
      <motion.span suppressHydrationWarning className="relative inline-block" style={{ transformOrigin: "50% 100%" }} {...word(1.2)}>
        <span className="bg-gradient-to-r from-amber-700 to-amber-800 bg-clip-text text-transparent">HR workspace.</span>
        <motion.span
          suppressHydrationWarning
          aria-hidden="true"
          className="absolute -bottom-1 left-0 h-[3px] w-full origin-left rounded-full bg-gradient-to-r from-amber-700 to-amber-800"
          initial={reduced ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ delay: 1.7, duration: 0.4, ease: EASE }}
        />
      </motion.span>
    </h1>
  );
}
