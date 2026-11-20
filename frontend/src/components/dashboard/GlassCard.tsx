/**
 * The dashboard page's own card shell: translucent white over the page's blue-white gradient, a soft
 * blue-grey shadow and a 2px hover lift — distinct from the shared `Card` (ui.tsx), which every other
 * signed-in page keeps using unchanged. Same title/actions/children API as `Card` so swapping one for the
 * other is a drop-in change.
 */
export function GlassCard({
  title, actions, children, className = "",
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-[20px] border border-[#e5e7eb] bg-white/80 shadow-[0_10px_30px_rgba(37,99,235,0.08)] ring-1 ring-inset ring-white/60 backdrop-blur-sm transition duration-200 motion-safe:hover:-translate-y-0.5 hover:shadow-[0_14px_34px_rgba(37,99,235,0.12)] ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e7eb] px-4 py-3">
          {title && <h2 className="font-display text-base font-bold text-charcoal">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
