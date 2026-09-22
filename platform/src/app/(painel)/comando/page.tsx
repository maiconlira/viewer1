import { db } from "@/lib/db";
import { PageHeader, Badge, Empty } from "@/components/ui";
import { AutoRefresh, SubmitButton } from "@/components/client";
import { createCommand } from "../../actions";
import { date } from "@/lib/utils";
import { aiEnabled } from "@/lib/claude";

const EXAMPLES = [
  "Me dê um resumo da agência hoje e o que precisa da minha atenção.",
  "Gere 6 ideias de conteúdo para cada cliente ativo com foco em datas comemorativas do próximo mês.",
  "Crie 4 posts para a próxima semana da empresa X, escreva as legendas, gere as artes e envie para aprovação.",
  "Cadastre o lead João da Pizzaria Bella, telefone 11 98888-7777, e peça para o SDR abordar agora.",
  "Peça ao atendimento para cobrar gentilmente as aprovações pendentes há mais de 2 dias.",
  "Contrate uma closer chamada Camila, consultiva e direta, focada em planos anuais.",
  "Redija o contrato da empresa X: gestão de Instagram + 12 posts/mês, R$ 1.800/mês, 12 meses.",
];

type Step = { tool: string; input: unknown; output: unknown; error?: boolean };

export default async function Comando() {
  const commands = await db.command.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  const running = commands.some((c) => c.status === "RUNNING");

  return (
    <div className="space-y-6">
      <AutoRefresh active={running} />
      <PageHeader
        title="⚡ Diretor IA"
        subtitle="Dê ordens em linguagem natural. O Diretor executa usando clientes, conteúdo, artes, WhatsApp, contratos, financeiro, prospecção e a equipe de IA."
      />
      {!aiEnabled() && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Configure ANTHROPIC_API_KEY para usar o Diretor IA.
        </div>
      )}

      <form action={createCommand} className="card space-y-3">
        <textarea name="prompt" required rows={4} className="input" placeholder="O que você quer que aconteça?" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((e) => (
              <span key={e} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600" title="Exemplo">
                {e}
              </span>
            ))}
          </div>
          <SubmitButton className="btn-ai" pending="Enviando...">Executar ordem</SubmitButton>
        </div>
      </form>

      {commands.length === 0 ? (
        <Empty>Nenhuma ordem ainda.</Empty>
      ) : (
        <div className="space-y-4">
          {commands.map((c) => {
            const steps = (c.steps as Step[] | null) ?? [];
            return (
              <div key={c.id} className="card">
                <div className="flex items-start justify-between gap-3">
                  <div className="font-medium">“{c.prompt}”</div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-400">{date(c.createdAt, true)}</span>
                    {c.status === "RUNNING" ? (
                      <Badge className="bg-sky-100 text-sky-800">Executando…</Badge>
                    ) : c.status === "DONE" ? (
                      <Badge className="bg-emerald-100 text-emerald-800">Concluída</Badge>
                    ) : (
                      <Badge className="bg-rose-100 text-rose-800">Falhou</Badge>
                    )}
                  </div>
                </div>
                {c.result && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm">{c.result}</div>}
                {steps.length > 0 && (
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-slate-500">{steps.length} ações executadas</summary>
                    <ol className="mt-2 space-y-1 text-xs">
                      {steps.map((s, i) => (
                        <li key={i} className={s.error ? "text-rose-600" : "text-slate-600"}>
                          <code className="font-semibold">{s.tool}</code> {JSON.stringify(s.input).slice(0, 160)}
                          {s.error && <> — {String(s.output).slice(0, 200)}</>}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
