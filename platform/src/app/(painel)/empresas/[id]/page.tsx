import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge, Collapsible, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CompanyFields } from "@/components/forms";
import {
  aiIdeas,
  createPostAction,
  deleteCompany,
  linkMetaPage,
  onboardCompany,
  saveMetaManual,
  savePublishOptions,
  unlinkMeta,
  updateCompany,
} from "../../../actions";
import { checkCompanyConnection, listMetaPages, type MetaPage } from "@/lib/meta";
import { getSecret } from "@/lib/settings";
import { periodLabel } from "@/lib/reports";
import {
  contractStatusLabel,
  date,
  invoiceStatusLabel,
  money,
  postStatusColor,
  postStatusLabel,
} from "@/lib/utils";

export default async function EmpresaDetalhe({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ testar?: string }>;
}) {
  const { id } = await params;
  const { testar } = await searchParams;
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
      reports: { orderBy: { period: "desc" }, take: 6 },
      meetings: { where: { status: "SCHEDULED", startAt: { gte: new Date() } }, orderBy: { startAt: "asc" }, take: 5 },
    },
  });
  if (!company) notFound();

  // Páginas disponíveis na conta do Facebook conectada (para vincular a esta empresa)
  const metaUserToken = await getSecret("meta_user_token");
  let pages: MetaPage[] = [];
  let pagesError: string | null = null;
  if (metaUserToken && !company.metaToken) {
    try {
      pages = await listMetaPages(metaUserToken);
    } catch (err) {
      pagesError = (err as Error).message;
    }
  }
  const connection = testar && company.metaToken ? await checkCompanyConnection(company) : null;

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
          <section id="redes" className="card">
            <h2 className="mb-3">Redes sociais</h2>
            {company.metaToken ? (
              <div className="space-y-3 text-sm">
                {company.igUserId && <div>📸 Instagram: <b>@{company.igUsername ?? company.igUserId}</b></div>}
                {company.fbPageId && <div>📘 Facebook: <b>{company.fbPageName ?? company.fbPageId}</b></div>}
                {!company.igUserId && <p className="text-xs text-amber-700">Esta página não tem Instagram profissional vinculado.</p>}
                {connection && (
                  <div className={`rounded p-2 text-xs ${connection.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
                    {connection.ok ? `✓ Conexão ok ${"instagram" in connection ? `— ${connection.instagram}` : ""}` : `Falhou: ${connection.error}`}
                  </div>
                )}
                <form key={`${company.autoPublish}-${company.crosspostFacebook}`} action={savePublishOptions.bind(null, company.id)} className="space-y-1">
                  <label className="flex items-center gap-2"><input type="checkbox" name="autoPublish" defaultChecked={company.autoPublish} /> Publicar automaticamente após aprovação</label>
                  <label className="flex items-center gap-2"><input type="checkbox" name="crosspostFacebook" defaultChecked={company.crosspostFacebook} /> Também postar no Facebook</label>
                  <SubmitButton className="btn-secondary btn-sm">Salvar</SubmitButton>
                </form>
                <div className="flex gap-2">
                  <Link href={`/empresas/${company.id}?testar=1#redes`} className="btn-secondary btn-sm">Testar conexão</Link>
                  <form action={unlinkMeta.bind(null, company.id)}>
                    <SubmitButton className="btn-danger btn-sm" confirm="Desconectar as redes desta empresa?">Desconectar</SubmitButton>
                  </form>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                {metaUserToken ? (
                  pagesError ? (
                    <p className="text-xs text-rose-700">Erro ao listar páginas: {pagesError}. Reconecte em Configurações.</p>
                  ) : (
                    <form action={linkMetaPage.bind(null, company.id)} className="space-y-2">
                      <select name="pageId" required className="input">
                        <option value="">Escolha a página do cliente...</option>
                        {pages.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}{p.instagram_business_account ? ` + IG @${p.instagram_business_account.username ?? p.instagram_business_account.id}` : " (sem Instagram)"}
                          </option>
                        ))}
                      </select>
                      <SubmitButton className="btn-primary btn-sm">Vincular</SubmitButton>
                    </form>
                  )
                ) : (
                  <p className="muted">
                    Conecte sua conta do Facebook em <Link href="/configuracoes" className="link">Configurações</Link> para escolher a página e o Instagram deste cliente.
                  </p>
                )}
                <details>
                  <summary className="cursor-pointer text-xs text-slate-500">Configurar manualmente (IDs + token)</summary>
                  <form action={saveMetaManual.bind(null, company.id)} className="mt-2 space-y-2">
                    <input name="igUserId" placeholder="ID do Instagram profissional" className="input" />
                    <input name="fbPageId" placeholder="ID da página do Facebook" className="input" />
                    <input name="token" type="password" placeholder="Token de acesso da página" className="input" />
                    <SubmitButton className="btn-secondary btn-sm">Salvar</SubmitButton>
                  </form>
                </details>
              </div>
            )}
          </section>

          <Section title="Relatórios" actions={<Link href={`/relatorios?companyId=${company.id}`} className="link text-sm">Todos →</Link>}>
            {company.reports.length === 0 ? (
              <Empty>Nenhum relatório ainda.</Empty>
            ) : (
              <ul className="space-y-2 text-sm">
                {company.reports.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <Link href={`/relatorios/${r.id}`} className="link">{periodLabel(r.period)}</Link>
                    <Badge className={r.status === "SENT" ? "bg-emerald-100 text-emerald-800" : undefined}>{r.status === "SENT" ? "Enviado" : "Rascunho"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {company.meetings.length > 0 && (
            <Section title="Próximas reuniões">
              <ul className="space-y-1 text-sm">
                {company.meetings.map((m) => <li key={m.id}>📅 {date(m.startAt, true)} — {m.title}</li>)}
              </ul>
            </Section>
          )}

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
