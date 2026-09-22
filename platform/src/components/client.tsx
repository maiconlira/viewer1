"use client";
import { useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

export function SubmitButton({
  children,
  className = "btn-primary",
  pending,
  confirm,
}: {
  children: React.ReactNode;
  className?: string;
  pending?: string;
  confirm?: string;
}) {
  const status = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={status.pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {status.pending ? (
        <>
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {pending ?? "Processando..."}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** Atualiza a página periodicamente enquanto `active` for verdadeiro (ex.: ordem em execução). */
export function AutoRefresh({ active, ms = 4000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), ms);
    return () => clearInterval(t);
  }, [active, ms, router]);
  return null;
}

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path.startsWith(href);
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
        active ? "bg-white/10 font-medium text-white" : "text-slate-300 hover:bg-white/5 hover:text-white"
      }`}
    >
      {children}
    </Link>
  );
}

export function CopyButton({ text, label = "Copiar" }: { text: string; label?: string }) {
  return (
    <button type="button" className="btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(text)}>
      {label}
    </button>
  );
}
