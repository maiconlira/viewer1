import Link from "next/link";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, href, tone }: { label: string; value: React.ReactNode; hint?: string; href?: string; tone?: "warn" | "bad" | "good" }) {
  const toneCls = tone === "bad" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : tone === "good" ? "text-emerald-600" : "text-slate-900";
  const inner = (
    <div className="card h-full transition hover:border-brand-200">
      <div className="label">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${toneCls}`}>{value}</div>
      {hint && <div className="muted mt-1">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={`badge ${className ?? "bg-slate-100 text-slate-700"}`}>{children}</span>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{children}</div>;
}

export function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2>{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Collapsible({ title, children, open }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="card group" open={open}>
      <summary className="cursor-pointer list-none text-sm font-semibold text-brand-700">
        <span className="group-open:hidden">＋ </span>
        <span className="hidden group-open:inline">－ </span>
        {title}
      </summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}
