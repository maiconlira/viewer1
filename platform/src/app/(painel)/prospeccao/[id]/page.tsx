import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge, PageHeader, Section } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { LeadFields } from "@/components/forms";
import { convertLead, deleteLead, moveLead, outreachLead, updateLead } from "../../../actions";
import { date, leadStageLabel } from "@/lib/utils";

export default async function LeadDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      agent: true,
      conversations: { include: { messages: { orderBy: { createdAt: "desc" }, take: 12 } } },
      activities: { orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!lead) notFound();
  const agents = await db.agent.findMany({ where: { active: true } });
  const conv = lead.conversations[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={lead.name}
        subtitle={[lead.businessName, lead.segment, lead.phone].filter(Boolean).join(" · ")}
        actions={
          <>
            <Badge className="bg-sky-100 text-sky-800">{leadStageLabel[lead.stage]}</Badge>
            {lead.phone && (
              <form action={outreachLead.bind(null, lead.id)}>
                <SubmitButton className="btn-ai" pending="IA escrevendo...">🤖 IA: fazer contato</SubmitButton>
              </form>
            )}
            {conv && <Link href={`/whatsapp/${conv.id}`} className="btn-secondary">💬 Conversa</Link>}
            {lead.convertedCompanyId ? (
              <Link href={`/empresas/${lead.convertedCompanyId}`} className="btn-primary">🏢 Ver cliente</Link>
            ) : (
              <form action={convertLead.bind(null, lead.id)}><SubmitButton confirm="Converter em cliente?">🎉 Fechou! Virar cliente</SubmitButton></form>
            )}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Section title="Dados">
            <form key={lead.updatedAt.toISOString()} action={updateLead.bind(null, lead.id)} className="space-y-4">
              <LeadFields l={lead} agents={agents} />
              <SubmitButton>Salvar</SubmitButton>
            </form>
          </Section>
          {lead.aiSummary && <Section title="Resumo da IA"><p className="whitespace-pre-wrap text-sm">{lead.aiSummary}</p></Section>}
        </div>
        <div className="space-y-6">
          <Section title="Status do funil">
            <div className="space-y-1 text-sm">
              <div>Último contato: {date(lead.lastContactAt, true)}</div>
              <div>Próximo follow-up: {date(lead.nextFollowUpAt, true)}</div>
              <div>Follow-ups feitos: {lead.followUpCount}</div>
              {lead.lostReason && <div className="text-rose-600">Perdido: {lead.lostReason}</div>}
            </div>
            {lead.stage !== "LOST" && (
              <form action={moveLead.bind(null, lead.id, "LOST")} className="mt-3">
                <SubmitButton className="btn-danger btn-sm">Marcar como perdido</SubmitButton>
              </form>
            )}
          </Section>
          {conv && (
            <Section title="Últimas mensagens">
              <ul className="space-y-2 text-xs">
                {[...conv.messages].reverse().map((m) => (
                  <li key={m.id} className={m.direction === "OUT" ? "text-emerald-800" : ""}>
                    <b>{m.direction === "OUT" ? m.author.replace("AI:", "🤖 ") : "Lead"}:</b> {m.body.slice(0, 220)}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Histórico">
            <ul className="space-y-1 text-xs">
              {lead.activities.map((a) => <li key={a.id}><span className="text-slate-400">{date(a.createdAt, true)}</span> {a.summary}</li>)}
            </ul>
          </Section>
          <form action={deleteLead.bind(null, lead.id)}>
            <SubmitButton className="btn-danger btn-sm" confirm="Excluir este lead?">Excluir lead</SubmitButton>
          </form>
        </div>
      </div>
    </div>
  );
}
