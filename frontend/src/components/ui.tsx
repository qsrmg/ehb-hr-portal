"use client";

import Link from "next/link";
import { STATUS_STYLES } from "@/lib/format";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
  loading?: boolean;
};

const buttonClass = (variant: ButtonProps["variant"] = "primary", size: ButtonProps["size"] = "md") =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-md font-medium transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1",
    size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-4 py-2 text-sm",
    variant === "primary" && "bg-brand text-white hover:bg-brand-dark",
    variant === "secondary" && "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50",
    variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
    variant === "ghost" && "text-slate-600 hover:bg-slate-100",
  );

export function Button({ variant, size, loading, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button className={cx(buttonClass(variant, size), className)} disabled={disabled || loading} {...rest}>
      {loading && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function LinkButton({ href, variant, size, className, children }: { href: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cx(buttonClass(variant, size), className)}>
      {children}
    </Link>
  );
}

export function Card({ title, actions, children, className }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg bg-white shadow-sm ring-1 ring-slate-200", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUS_STYLES[status] ?? { label: status, className: "bg-slate-50 text-slate-600 ring-slate-200" };
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", s.className)}>{label ?? s.label}</span>;
}

export function Badge({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex items-center rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{children}</span>;
}

export function Field({ label, hint, error, children, className }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  );
}

const inputClass = "block w-full rounded-md border-0 bg-white px-3 py-2 text-sm text-slate-900 ring-1 ring-inset ring-slate-300 placeholder:text-slate-400 focus:ring-2 focus:ring-inset focus:ring-accent disabled:bg-slate-50 disabled:text-slate-500";

export const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} className={cx(inputClass, props.className)} />;
export const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} className={cx(inputClass, props.className)} />;
export const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea rows={3} {...props} className={cx(inputClass, props.className)} />;

export function Alert({ kind = "error", children }: { kind?: "error" | "success" | "info" | "warning"; children: React.ReactNode }) {
  const styles = {
    error: "bg-red-50 text-red-800 ring-red-200",
    success: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    info: "bg-sky-50 text-sky-800 ring-sky-200",
    warning: "bg-amber-50 text-amber-900 ring-amber-200",
  }[kind];
  return <div role={kind === "error" ? "alert" : "status"} className={cx("rounded-md px-3 py-2 text-sm ring-1 ring-inset", styles)}>{children}</div>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-brand" />
      {label}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function Table({ head, children, empty }: { head: React.ReactNode[]; children: React.ReactNode; empty?: React.ReactNode }) {
  const rows = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div className="-mx-4 overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {rows.length === 0 && empty && <Empty>{empty}</Empty>}
    </div>
  );
}

export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <td className={cx("whitespace-nowrap px-4 py-2.5 text-slate-700", className)}>{children}</td>
);

export function Stat({ label, value, tone, sub }: { label: string; value: React.ReactNode; tone?: "green" | "amber" | "orange" | "red" | "sky" | "slate"; sub?: React.ReactNode }) {
  const color = {
    green: "text-emerald-700", amber: "text-amber-700", orange: "text-orange-700", red: "text-red-700", sky: "text-sky-700", slate: "text-slate-900",
  }[tone ?? "slate"];
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx("mt-1 text-2xl font-semibold tabular-nums", color)}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[] }) {
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium",
            value === o.value ? "border-brand text-brand" : "border-transparent text-slate-500 hover:text-slate-700",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value || "—"}</dd>
    </div>
  );
}
