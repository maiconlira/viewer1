import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Collapsible, Empty, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { startConversation } from "../../actions";
import { date } from "@/lib/utils";
import { whatsappProvider } from "@/lib/whatsapp";

export default async function WhatsApp() {
  const conversations = await db.conversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    take: 100,
    include: {
      company: { select: { name: true } },
      lead: { select: { name: true, stage: true } },
      agent: { select: { name: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  const provider = whatsappProvider();

  return (
    <div className="space-y-6">
      <PageHeader
        title="WhatsApp"
        subtitle={`Provedor: ${provider === "none" ? "simulação (nada é enviado)" : provider}. Os funcionários de IA respondem automaticamente; assuma quando quiser.`}
      />
      <Collapsible title="Nova conversa">
        <form action={startConversation} className="grid gap-3 md:grid-cols-4">
          <input name="phone" required placeholder="WhatsApp com DDD" className="input" />
          <input name="text" required placeholder="Mensagem" className="input md:col-span-2" />
          <SubmitButton>Enviar</SubmitButton>
        </form>
      </Collapsible>
      {conversations.length === 0 ? <Empty>Nenhuma conversa ainda.</Empty> : (
        <div className="card divide-y divide-slate-100 p-0">
          {conversations.map((c) => {
            const last = c.messages[0];
            return (
              <Link key={c.id} href={`/whatsapp/${c.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-slate-50">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-600">
                  {(c.contactName ?? c.phone).slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{c.contactName ?? c.phone}</span>
                    {c.company && <Badge className="bg-emerald-100 text-emerald-800">Cliente: {c.company.name}</Badge>}
                    {c.lead && !c.company && <Badge className="bg-sky-100 text-sky-800">Lead · {c.lead.stage}</Badge>}
                    {c.mode === "HUMAN" ? <Badge className="bg-amber-100 text-amber-800">Humano</Badge> : <Badge className="bg-violet-100 text-violet-800">IA{c.agent ? `: ${c.agent.name}` : ""}</Badge>}
                  </div>
                  <div className="truncate text-sm text-slate-500">
                    {last ? `${last.direction === "OUT" ? "↪ " : ""}${last.body}` : "—"}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-xs text-slate-400">{date(c.lastMessageAt, true)}</div>
                  {c.unread > 0 && <span className="mt-1 inline-block rounded-full bg-emerald-500 px-2 text-xs font-semibold text-white">{c.unread}</span>}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
