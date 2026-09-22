import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge, Collapsible, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CompanyFields } from "@/components/forms";
import { aiIdeas, createPostAction, deleteCompany, onboardCompany, updateCompany } from "../../../actions";
import {
  contractStatusLabel,
  date,
  invoiceStatusLabel,
  money,
  postStatusColor,
  postStatusLabel,
} from "@/lib/utils";

export default async function EmpresaDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = await db.company.findUnique({
    where: { id },
    include: {
      posts: { orderBy: [{ scheduledAt: "desc" }, { createdAt: "desc" }], take: 30 },
      ideas: { where: { status: { in: ["NEW", "APPROVED"] } }, orderBy: { createdAt: "desc" }, take: 20 },
      contracts: { orderBy: { createdAt: "desc" } },
      invoices: { orderBy: { dueDate: "desc" }, take: 12 },
      tasks: { where: { status: { not: "DONE" } }, orderBy: { createdAt: "desc" } },
      conversations: { take: 1 },
      activities: { orderBy: { createdAt: "desc" }, take: 15 },
    },
  });
  if (!company) notFound();

  const pending = company.posts.filter((p) => p.status === "PENDING_APPROVAL" || p.status === "CHANGES_REQUESTED").length;
  const openInvoices = company.invoices.filter((i) => i.status === "PENDING" || i.status === "OVERDUE");
  const conv = company.conversations[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={company.name}
        subtitle={[company.segment, company.contactName, company.whatsapp].filter(Boolean).join(" · ")}
        actions={
          <>
            {conv && <Link href={`/whatsapp/${conv.id}`} className="btn-secondary">💬 Conversa</Link>}
            {company.whatsapp && (
              <form action={onboardCompany.bind(null, company.id)}>
                <SubmitButton className="btn-secondary" pending="Enviando...">👋 Onboarding por IA</SubmitButton>
              </form>
            )}
            <Link href={`/contratos?companyId=${company.id}`} className="btn-secondary">📄 Novo contrato</Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Mensalidade" value={company.monthlyFee ? money(company.monthlyFee) : "—"} hint={company.billingDay ? `vence dia ${company.billingDay}` : undefined} />
        <Stat label="Posts em aprovação" value={pending} tone={pending ? "warn" : undefined} />
        <Stat label="Faturas em aberto" value={openInvoices.length} tone={openInvoices.some((i) => i.status === "OVERDUE") ? "bad" : undefined} />
        <Stat label="Tarefas abertas" value={company.tasks.length} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section
            title="Postagens"
            actions={<Link href={`/conteudo?companyId=${company.id}`} className="link text-sm">Quadro →</Link>}
          >
            <details className="mb-4">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">＋ Nova postagem</summary>
              <form action={createPostAction} className="mt-3 grid gap-3 md:grid-cols-2">
                <input type="hidden" name="companyId" value={company.id} />
                <input name="title" required placeholder="Título / pauta" className="input md:col-span-2" />
                <select name="platform" className="input">
                  {["INSTAGRAM", "FACEBOOK", "TIKTOK", "LINKEDIN", "YOUTUBE"].map((p) => <option key={p}>{p}</option>)}
                </select>
                <select name="format" className="input">
                  {["FEED", "CAROUSEL", "REELS", "STORY", "VIDEO"].map((p) => <option key={p}>{p}</option>)}
                </select>
                <input type="datetime-local" name="scheduledAt" className="input" />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="aiCaption" defaultChecked /> Escrever legenda com IA
                </label>
                <SubmitButton pending="Criando...">Criar postagem</SubmitButton>
              </form>
            </details>
            {company.posts.length === 0 ? (
              <Empty>Nenhuma postagem.</Empty>
            ) : (
              <table className="table">
                <thead><tr><th>Título</th><th>Data</th><th>Status</th></tr></thead>
                <tbody>
                  {company.posts.map((p) => (
                    <tr key={p.id}>
                      <td><Link href={`/conteudo/${p.id}`} className="link">{p.title}</Link><div className="text-xs text-slate-400">{p.platform} · {p.format}</div></td>
                      <td className="whitespace-nowrap">{date(p.scheduledAt, true)}</td>
                      <td><Badge className={postStatusColor[p.status]}>{postStatusLabel[p.status]}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>

          <Section title="Banco de ideias">
            <form action={aiIdeas} className="mb-4 flex flex-wrap gap-2">
              <input type="hidden" name="companyId" value={company.id} />
              <input name="theme" placeholder="Tema (opcional): Black Friday, bastidores..." className="input flex-1" />
              <input name="count" type="number" defaultValue={5} min={1} max={20} className="input w-20" />
              <SubmitButton className="btn-ai" pending="Gerando...">✨ Gerar ideias</SubmitButton>
            </form>
            {company.ideas.length === 0 ? (
              <Empty>Sem ideias abertas.</Empty>
            ) : (
              <ul className="space-y-2">
                {company.ideas.map((i) => (
                  <li key={i.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                    <div className="font-medium">{i.title} <span className="text-xs font-normal text-slate-400">({i.source})</span></div>
                    {i.description && <div className="mt-1 text-slate-600">{i.description}</div>}
                  </li>
                ))}
              </ul>
            )}
            <Link href={`/ideias?companyId=${company.id}`} className="link mt-3 inline-block text-sm">Gerenciar ideias →</Link>
          </Section>

          <Collapsible title="Editar dados e marca">
            <form key={company.updatedAt.toISOString()} action={updateCompany.bind(null, company.id)} className="space-y-4">
              <CompanyFields c={company} />
              <div className="flex justify-between">
                <SubmitButton>Salvar</SubmitButton>
              </div>
            </form>
            <form action={deleteCompany.bind(null, company.id)} className="mt-6 border-t border-slate-100 pt-4">
              <SubmitButton className="btn-danger btn-sm" confirm="Excluir a empresa e TODOS os dados dela?">Excluir empresa</SubmitButton>
            </form>
          </Collapsible>
        </div>

        <div className="space-y-6">
          <Section title="Contratos">
            {company.contracts.length === 0 ? (
              <Empty>Nenhum contrato.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {company.contracts.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-2">
                    <Link href={`/contratos/${c.id}`} className="link truncate">{c.title}</Link>
                    <Badge>{contractStatusLabel[c.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Financeiro">
            {company.invoices.length === 0 ? (
              <Empty>Nenhuma cobrança.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {company.invoices.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2">
                    <span>{i.description}<br /><span className="text-xs text-slate-400">{money(i.amount)} · {date(i.dueDate)}</span></span>
                    <Badge className={i.status === "OVERDUE" ? "bg-rose-100 text-rose-800" : i.status === "PAID" ? "bg-emerald-100 text-emerald-800" : undefined}>
                      {invoiceStatusLabel[i.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Tarefas abertas">
            {company.tasks.length === 0 ? <Empty>Nenhuma.</Empty> : (
              <ul className="space-y-2 text-sm">
                {company.tasks.map((t) => <li key={t.id}>{t.forAdmin ? "⚠️ " : "• "}{t.title}</li>)}
              </ul>
            )}
          </Section>

          <Section title="Histórico">
            <ul className="space-y-2 text-xs">
              {company.activities.map((a) => (
                <li key={a.id}><span className="text-slate-400">{date(a.createdAt, true)}</span> {a.summary}</li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
