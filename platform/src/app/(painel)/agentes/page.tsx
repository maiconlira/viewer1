import type { Agent } from "@prisma/client";
import { db } from "@/lib/db";
import { Badge, Collapsible, Empty, Field, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createAgent, deleteAgent, updateAgent } from "../../actions";
import { agentRoleLabel } from "@/lib/utils";

function AgentFields({ a }: { a?: Agent }) {
  return (
    <div className="grid gap-4 md:grid-cols-4">
      <Field label="Nome"><input name="name" required defaultValue={a?.name} className="input" /></Field>
      <Field label="Função">
        <select name="role" defaultValue={a?.role ?? "SDR"} className="input">
          {Object.entries(agentRoleLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Follow-up a cada (dias)"><input name="followUpDays" type="number" min={1} defaultValue={a?.followUpDays ?? 2} className="input" /></Field>
      <Field label="Máx. follow-ups"><input name="maxFollowUps" type="number" min={0} defaultValue={a?.maxFollowUps ?? 3} className="input" /></Field>
      <Field label="Personalidade e processo" className="md:col-span-4">
        <textarea name="persona" rows={5} required defaultValue={a?.persona} className="input" placeholder="Como fala, o que pergunta, em que ordem, o que nunca faz..." />
      </Field>
      <Field label="Metas" className="md:col-span-4">
        <textarea name="goals" rows={2} defaultValue={a?.goals ?? ""} className="input" placeholder="Ex.: agendar reunião com leads de ticket acima de R$ 1.500" />
      </Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={a?.active ?? true} /> Ativo</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isDefault" defaultChecked={a?.isDefault ?? false} /> Padrão da função</label>
    </div>
  );
}

export default async function Agentes() {
  const agents = await db.agent.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    include: { _count: { select: { leads: true, conversations: true } } },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Equipe de IA"
        subtitle="Funcionários personalizados que atendem pelo WhatsApp: do primeiro contato ao pós-venda. Cada conversa é atendida pelo agente padrão da função adequada."
      />
      <Collapsible title="Contratar funcionário de IA">
        <form action={createAgent} className="space-y-4">
          <AgentFields />
          <SubmitButton>Criar</SubmitButton>
        </form>
      </Collapsible>
      {agents.length === 0 ? (
        <Empty>Nenhum agente. Rode <code>npm run db:seed</code> para criar a equipe inicial ou crie acima.</Empty>
      ) : (
        <div className="space-y-4">
          {agents.map((a) => (
            <details key={a.id} className="card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100 text-lg">🤖</div>
                  <div>
                    <div className="font-semibold">{a.name}</div>
                    <div className="muted">{agentRoleLabel[a.role]}</div>
                  </div>
                </div>
                <div className="flex gap-2">
                  {a.isDefault && <Badge className="bg-brand-100 text-brand-700">Padrão</Badge>}
                  {!a.active && <Badge className="bg-slate-200">Inativo</Badge>}
                  <Badge>{a._count.leads} leads</Badge>
                  <Badge>{a._count.conversations} conversas</Badge>
                </div>
              </summary>
              <form action={updateAgent.bind(null, a.id)} className="mt-4 space-y-4">
                <AgentFields a={a} />
                <SubmitButton>Salvar</SubmitButton>
              </form>
              <form action={deleteAgent.bind(null, a.id)} className="mt-3">
                <SubmitButton className="btn-danger btn-sm" confirm="Demitir este agente?">Excluir</SubmitButton>
              </form>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
