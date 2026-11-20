"use client";

import { useEffect, useRef, useState } from "react";

/** True once the element is on screen (IntersectionObserver) and the tab itself is visible — used to pause
 * a 3D render loop rather than just hiding it. Kept local to components/orbit/ (not imported from
 * components/dashboard/) so this directory stays self-contained and portable, per the brief. */
export function useOnScreenAndVisible<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(!!entry?.isIntersecting), { threshold: 0.01 });
    io.observe(el);
    const onVisibility = () => setTabVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return { ref, active: onScreen && tabVisible };
}
