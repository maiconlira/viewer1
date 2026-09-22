import Link from "next/link";
import { db } from "@/lib/db";
import { dashboardSummary } from "@/lib/services";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createCommand, runTickNow, setTaskStatus } from "../actions";
import { date, leadStageLabel, money, postStatusColor, postStatusLabel } from "@/lib/utils";
import { aiEnabled } from "@/lib/claude";
import { whatsappProvider } from "@/lib/whatsapp";
import type { LeadStage } from "@prisma/client";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "WON"];

export default async function Dashboard() {
  const [s, escalations, activity, upcoming, meetings] = await Promise.all([
    dashboardSummary(),
    db.task.findMany({
      where: { forAdmin: true, status: { not: "DONE" } },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { company: { select: { name: true } }, lead: { select: { name: true } } },
    }),
    db.activity.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    db.post.findMany({
      where: { scheduledAt: { gte: new Date() } },
      orderBy: { scheduledAt: "asc" },
      take: 6,
      include: { company: { select: { name: true } } },
    }),
    db.meeting.findMany({
      where: { status: "SCHEDULED", startAt: { gte: new Date() } },
      orderBy: { startAt: "asc" },
      take: 5,
      include: { lead: { select: { name: true } }, company: { select: { name: true } } },
    }),
  ]);

  const warnings = [
    !aiEnabled() && "Configure ANTHROPIC_API_KEY para ativar os funcionários de IA e o Diretor IA.",
    whatsappProvider() === "none" && "WhatsApp em modo simulação: as mensagens são registradas, mas não enviadas. Configure a Evolution API ou a Cloud API.",
  ].filter(Boolean) as string[];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Painel"
        subtitle="Visão geral da agência — você dá as ordens, a equipe de IA executa."
        actions={
          <form action={runTickNow}>
            <SubmitButton className="btn-secondary" pending="Rodando...">↻ Rodar automações agora</SubmitButton>
          </form>
        }
      />

      {warnings.map((w) => (
        <div key={w} className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {w} <Link href="/configuracoes" className="font-medium underline">Configurações</Link>
        </div>
      ))}

      <form action={createCommand} className="card flex flex-col gap-3 md:flex-row md:items-center">
        <span className="text-2xl">⚡</span>
        <input
          name="prompt"
          required
          className="input flex-1"
          placeholder='Dê uma ordem ao Diretor IA — ex.: "Planeje 8 posts de novembro para a Padaria Sol e envie os 2 primeiros para aprovação"'
        />
        <SubmitButton className="btn-ai" pending="Enviando...">Executar</SubmitButton>
      </form>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Clientes ativos" value={s.activeCompanies} hint={`MRR ${money(s.mrr)}`} href="/empresas" />
        <Stat
          label="Aguardando aprovação"
          value={s.pendingApprovals}
          hint={`${s.changesRequested} com alteração pedida`}
          href="/conteudo"
          tone={s.changesRequested ? "warn" : undefined}
        />
        <Stat label="Posts nos próximos 7 dias" value={s.postsNext7Days} href="/cronograma" />
        <Stat
          label="Inadimplência"
          value={money(s.overdueInvoices.total)}
          hint={`${s.overdueInvoices.count} fatura(s)`}
          href="/financeiro"
          tone={s.overdueInvoices.count ? "bad" : "good"}
        />
      </div>

      <Section title="Funil de prospecção" actions={<Link href="/prospeccao" className="link text-sm">Abrir funil →</Link>}>
        <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
          {STAGES.map((st) => (
            <div key={st} className="rounded-lg bg-slate-50 p-3 text-center">
              <div className="text-xl font-semibold">{s.leadsByStage[st] ?? 0}</div>
              <div className="text-xs text-slate-500">{leadStageLabel[st]}</div>
            </div>
          ))}
        </div>
      </Section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Section title={`Precisa de você (${escalations.length})`} actions={<Link href="/tarefas" className="link text-sm">Ver tudo →</Link>}>
          {escalations.length === 0 ? (
            <Empty>Nada pendente. A equipe está dando conta 👌</Empty>
          ) : (
            <ul className="space-y-3">
              {escalations.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 rounded-lg border border-rose-100 bg-rose-50/50 p-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{t.title}</div>
                    {t.description && <div className="mt-0.5 line-clamp-2 text-xs text-slate-600">{t.description}</div>}
                    <div className="mt-1 text-xs text-slate-400">
                      {t.createdBy} · {t.company?.name ?? t.lead?.name ?? ""} · {date(t.createdAt, true)}
                    </div>
                  </div>
                  <form action={setTaskStatus.bind(null, t.id, "DONE")}>
                    <SubmitButton className="btn-secondary btn-sm" pending="...">Resolvido</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Próximas postagens" actions={<Link href="/cronograma" className="link text-sm">Cronograma →</Link>}>
          {upcoming.length === 0 ? (
            <Empty>Nenhuma postagem agendada.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {upcoming.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/conteudo/${p.id}`} className="min-w-0">
                    <div className="truncate text-sm font-medium">{p.title}</div>
                    <div className="text-xs text-slate-500">
                      {p.company.name} · {date(p.scheduledAt, true)}
                    </div>
                  </Link>
                  <Badge className={postStatusColor[p.status]}>{postStatusLabel[p.status]}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      {meetings.length > 0 && (
        <Section title="Próximas reuniões" actions={<Link href="/agenda" className="link text-sm">Agenda →</Link>}>
          <ul className="divide-y divide-slate-100">
            {meetings.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span>
                  <b>{date(m.startAt, true)}</b> — {m.title}
                  <span className="text-slate-400"> · {m.lead?.name ?? m.company?.name ?? ""} · {m.bookedBy}</span>
                </span>
                {m.meetLink && <a href={m.meetLink} target="_blank" className="link">Meet</a>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Atividade recente">
        {activity.length === 0 ? (
          <Empty>Sem atividade ainda.</Empty>
        ) : (
          <ul className="space-y-2">
            {activity.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="w-24 shrink-0 text-xs text-slate-400">{date(a.createdAt, true)}</span>
                <span className="flex-1">{a.summary}</span>
                <span className="shrink-0 text-xs text-slate-400">{a.actor}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
