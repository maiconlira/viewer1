import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge, PageHeader, Section } from "@/components/ui";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { instructAgent, sendManualMessage, setConversationAgent, setConversationMode } from "../../../actions";
import { agentRoleLabel, date } from "@/lib/utils";

const statusIcon: Record<string, string> = { SENT: "✓", FAILED: "⚠ falhou", DRY_RUN: "◌ simulado", RECEIVED: "" };

export default async function Conversa({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = await db.conversation.findUnique({
    where: { id },
    include: {
      company: true,
      lead: true,
      agent: true,
      messages: { orderBy: { createdAt: "desc" }, take: 200 },
    },
  });
  if (!conv) notFound();
  if (conv.unread) await db.conversation.update({ where: { id }, data: { unread: 0 } });
  const agents = await db.agent.findMany({ where: { active: true }, orderBy: { name: "asc" } });
  const messages = [...conv.messages].reverse();

  return (
    <div className="space-y-6">
      <AutoRefresh active ms={6000} />
      <PageHeader
        title={conv.contactName ?? conv.phone}
        subtitle={conv.phone}
        actions={
          <>
            {conv.company && <Link href={`/empresas/${conv.company.id}`} className="btn-secondary">🏢 {conv.company.name}</Link>}
            {conv.lead && <Link href={`/prospeccao/${conv.lead.id}`} className="btn-secondary">🎯 Lead: {conv.lead.stage}</Link>}
            {conv.mode === "AI" ? (
              <form action={setConversationMode.bind(null, conv.id, "HUMAN")}><SubmitButton className="btn-secondary">✋ Assumir conversa</SubmitButton></form>
            ) : (
              <form action={setConversationMode.bind(null, conv.id, "AI")}><SubmitButton className="btn-ai">🤖 Devolver para IA</SubmitButton></form>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card flex flex-col p-0 lg:col-span-2">
          <div className="flex max-h-[65vh] min-h-[40vh] flex-col gap-2 overflow-y-auto bg-[#efeae2] p-4">
            {messages.map((m) => (
              <div key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 text-sm shadow-sm ${m.direction === "OUT" ? "self-end bg-[#d9fdd3]" : "self-start bg-white"}`}>
                {m.direction === "OUT" && <div className="mb-0.5 text-[10px] font-semibold text-emerald-700">{m.author.replace("AI:", "🤖 ")}</div>}
                {m.mediaUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.mediaUrl} alt="" className="mb-1 max-h-60 rounded" />
                )}
                <div className="whitespace-pre-wrap">{m.body}</div>
                <div className="mt-0.5 text-right text-[10px] text-slate-500">
                  {date(m.createdAt, true)} {statusIcon[m.status] ?? ""}
                  {m.error && <span title={m.error} className="text-rose-600"> ⓘ</span>}
                </div>
              </div>
            ))}
          </div>
          <form action={sendManualMessage.bind(null, conv.id)} className="flex gap-2 border-t border-slate-200 p-3">
            <input name="text" required className="input flex-1" placeholder="Escreva como você (a IA não interfere nesta mensagem)" autoComplete="off" />
            <SubmitButton pending="...">Enviar</SubmitButton>
          </form>
        </div>

        <div className="space-y-6">
          <Section title="Funcionário de IA">
            <div className="mb-3 text-sm">
              Modo: {conv.mode === "AI" ? <Badge className="bg-violet-100 text-violet-800">IA respondendo</Badge> : <Badge className="bg-amber-100 text-amber-800">Humano (IA pausada)</Badge>}
            </div>
            <form key={conv.agentId ?? "auto"} action={setConversationAgent.bind(null, conv.id)} className="flex gap-2">
              <select name="agentId" defaultValue={conv.agentId ?? ""} className="input">
                <option value="">Automático (pelo contexto)</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name} — {agentRoleLabel[a.role]}</option>)}
              </select>
              <SubmitButton className="btn-secondary">OK</SubmitButton>
            </form>
          </Section>
          <Section title="Dar uma ordem ao agente">
            <form action={instructAgent.bind(null, conv.id)} className="space-y-2">
              <textarea name="instruction" rows={3} required className="input" placeholder="Ex.: cobre a aprovação do post de sexta com gentileza / ofereça 10% no plano anual / peça o logo em alta" />
              <SubmitButton className="btn-ai w-full" pending="Agente trabalhando...">Executar</SubmitButton>
            </form>
          </Section>
        </div>
      </div>
    </div>
  );
}
