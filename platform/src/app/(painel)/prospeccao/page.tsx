import Link from "next/link";
import type { LeadStage } from "@prisma/client";
import { db } from "@/lib/db";
import { Collapsible, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { LeadFields } from "@/components/forms";
import { createLead, importLeads, moveLead } from "../../actions";
import { agentRoleLabel, date, leadStageLabel, money } from "@/lib/utils";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "QUALIFIED", "MEETING", "PROPOSAL", "WON", "LOST"];
const NEXT: Partial<Record<LeadStage, LeadStage>> = { NEW: "CONTACTED", CONTACTED: "QUALIFIED", QUALIFIED: "MEETING", MEETING: "PROPOSAL" };

export default async function Prospeccao() {
  const [leads, agents] = await Promise.all([
    db.lead.findMany({
      where: { OR: [{ stage: { notIn: ["WON", "LOST"] } }, { updatedAt: { gte: new Date(Date.now() - 30 * 86400000) } }] },
      orderBy: { updatedAt: "desc" },
      include: { agent: { select: { name: true } } },
    }),
    db.agent.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
  ]);
  const pipeline = leads.filter((l) => l.stage !== "LOST" && l.stage !== "WON").reduce((s, l) => s + Number(l.estimatedValue ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Prospecção" subtitle={`Pipeline aberto: ${money(pipeline)}/mês · os SDRs de IA fazem primeiro contato e follow-ups automaticamente`} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Collapsible title="Cadastrar lead">
          <form action={createLead} className="space-y-4">
            <LeadFields agents={agents} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="outreach" /> IA faz o primeiro contato agora pelo WhatsApp</label>
            <SubmitButton pending="Salvando...">Cadastrar</SubmitButton>
          </form>
        </Collapsible>
        <Collapsible title="Importar lista">
          <form action={importLeads} className="space-y-3">
            <p className="muted">Uma linha por lead: <code>nome; telefone; empresa; segmento; origem</code> (separado por ; ou tab — cole direto da planilha)</p>
            <textarea name="rows" rows={6} required className="input font-mono text-xs" placeholder={"Maria Souza; 11988887777; Doceria da Maria; Confeitaria; Instagram"} />
            <select name="agentId" className="input">
              <option value="">SDR padrão</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {agentRoleLabel[a.role]}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="outreach" /> Disparar primeiro contato por IA para todos</label>
            <SubmitButton pending="Importando...">Importar</SubmitButton>
          </form>
        </Collapsible>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const items = leads.filter((l) => l.stage === stage);
          return (
            <div key={stage} className="w-64 shrink-0">
              <div className="mb-2 flex justify-between px-1 text-sm font-medium">
                <span>{leadStageLabel[stage]}</span>
                <span className="text-slate-400">{items.length}</span>
              </div>
              <div className="space-y-2">
                {items.map((l) => (
                  <div key={l.id} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                    <Link href={`/prospeccao/${l.id}`} className="block">
                      <div className="text-sm font-medium">{l.name}</div>
                      {l.businessName && <div className="text-xs text-slate-500">{l.businessName}</div>}
                      <div className="mt-1 text-xs text-slate-400">
                        {l.agent ? `🤖 ${l.agent.name}` : "sem agente"}
                        {l.estimatedValue ? ` · ${money(l.estimatedValue)}` : ""}
                      </div>
                      {l.nextFollowUpAt && <div className="text-xs text-slate-400">follow-up {date(l.nextFollowUpAt, true)}</div>}
                    </Link>
                    {NEXT[stage] && (
                      <form action={moveLead.bind(null, l.id, NEXT[stage]!)} className="mt-2">
                        <SubmitButton className="btn-secondary btn-sm w-full" pending="...">→ {leadStageLabel[NEXT[stage]!]}</SubmitButton>
                      </form>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
