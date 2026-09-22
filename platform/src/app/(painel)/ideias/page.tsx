import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CompanyFilter } from "@/components/company-filter";
import { aiIdeas, createIdeaAction, ideaToPost, setIdeaStatus } from "../../actions";
import { date } from "@/lib/utils";

export default async function Ideias({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const { companyId } = await searchParams;
  const [companies, ideas] = await Promise.all([
    db.company.findMany({ where: { status: { not: "CHURNED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.idea.findMany({
      where: { companyId: companyId || undefined, status: { in: ["NEW", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
      include: { company: { select: { name: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Banco de ideias" subtitle="Ideias da equipe, dos clientes (via WhatsApp) e geradas por IA" actions={<CompanyFilter companies={companies} current={companyId} />} />
      <div className="grid gap-6 md:grid-cols-2">
        <Section title="✨ Gerar com IA">
          <form action={aiIdeas} className="space-y-3">
            <select name="companyId" required defaultValue={companyId ?? ""} className="input">
              <option value="" disabled>Empresa...</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input name="theme" placeholder="Tema/objetivo (opcional)" className="input" />
            <div className="flex gap-2">
              <input name="count" type="number" defaultValue={6} min={1} max={20} className="input w-24" />
              <SubmitButton className="btn-ai flex-1" pending="Gerando...">Gerar ideias</SubmitButton>
            </div>
          </form>
        </Section>
        <Section title="Anotar ideia">
          <form action={createIdeaAction} className="space-y-3">
            <select name="companyId" required defaultValue={companyId ?? ""} className="input">
              <option value="" disabled>Empresa...</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input name="title" required placeholder="Ideia" className="input" />
            <textarea name="description" rows={2} placeholder="Detalhes" className="input" />
            <SubmitButton>Salvar</SubmitButton>
          </form>
        </Section>
      </div>

      {ideas.length === 0 ? <Empty>Nenhuma ideia aberta.</Empty> : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ideas.map((i) => (
            <div key={i.id} className="card flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <div className="font-medium">{i.title}</div>
                <Badge className={i.source === "CLIENT" ? "bg-emerald-100 text-emerald-800" : i.source === "AI" ? "bg-violet-100 text-violet-800" : undefined}>
                  {i.source === "CLIENT" ? "Cliente" : i.source === "AI" ? "IA" : "Equipe"}
                </Badge>
              </div>
              <Link href={`/empresas/${i.companyId}`} className="text-xs text-slate-500 hover:underline">{i.company.name} · {date(i.createdAt)}</Link>
              {i.description && <p className="mt-2 flex-1 whitespace-pre-wrap text-sm text-slate-600">{i.description}</p>}
              <div className="mt-3 flex gap-2">
                <form action={ideaToPost.bind(null, i.id)}><SubmitButton className="btn-primary btn-sm">→ Virar postagem</SubmitButton></form>
                {i.status === "NEW" && <form action={setIdeaStatus.bind(null, i.id, "APPROVED")}><SubmitButton className="btn-secondary btn-sm">👍</SubmitButton></form>}
                <form action={setIdeaStatus.bind(null, i.id, "DISCARDED")}><SubmitButton className="btn-secondary btn-sm">Descartar</SubmitButton></form>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
