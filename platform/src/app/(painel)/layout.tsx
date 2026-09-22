import { NavLink } from "@/components/client";
import { AGENCY_NAME } from "@/lib/utils";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", icon: "◎", label: "Painel" },
  { href: "/comando", icon: "⚡", label: "Diretor IA" },
  { href: "/empresas", icon: "🏢", label: "Empresas" },
  { href: "/conteudo", icon: "🖼", label: "Postagens" },
  { href: "/cronograma", icon: "📅", label: "Cronograma" },
  { href: "/ideias", icon: "💡", label: "Ideias" },
  { href: "/agenda", icon: "🗓", label: "Agenda" },
  { href: "/whatsapp", icon: "💬", label: "WhatsApp" },
  { href: "/prospeccao", icon: "🎯", label: "Prospecção" },
  { href: "/agentes", icon: "🤖", label: "Equipe de IA" },
  { href: "/contratos", icon: "📄", label: "Contratos" },
  { href: "/financeiro", icon: "💰", label: "Financeiro" },
  { href: "/relatorios", icon: "📊", label: "Relatórios" },
  { href: "/tarefas", icon: "✅", label: "Tarefas" },
  { href: "/configuracoes", icon: "⚙", label: "Configurações" },
];

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const [unread, escalations] = await Promise.all([
    db.conversation.aggregate({ _sum: { unread: true } }),
    db.task.count({ where: { forAdmin: true, status: { not: "DONE" } } }),
  ]);
  const badges: Record<string, number> = { "/whatsapp": unread._sum.unread ?? 0, "/tarefas": escalations };

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-slate-900 p-4 md:flex">
        <div className="mb-6 px-2">
          <div className="text-lg font-bold text-white">{AGENCY_NAME}</div>
          <div className="text-xs text-slate-400">Agência OS</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>
              <span className="w-5 text-center">{n.icon}</span>
              <span className="flex-1">{n.label}</span>
              {badges[n.href] ? (
                <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-semibold text-white">{badges[n.href]}</span>
              ) : null}
            </NavLink>
          ))}
        </nav>
        <form action="/api/auth/logout" method="post" className="mt-4 px-2">
          <button className="text-xs text-slate-400 hover:text-white">Sair</button>
        </form>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex gap-1 overflow-x-auto bg-slate-900 p-2 md:hidden">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>
              <span>{n.icon}</span>
              <span className="whitespace-nowrap">{n.label}</span>
            </NavLink>
          ))}
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
