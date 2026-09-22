import Link from "next/link";
import type { TaskStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { Collapsible, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { createTask, setTaskStatus } from "../../actions";
import { date } from "@/lib/utils";

const COLS: { status: TaskStatus; label: string }[] = [
  { status: "TODO", label: "A fazer" },
  { status: "DOING", label: "Fazendo" },
  { status: "DONE", label: "Feito" },
];

export default async function Tarefas() {
  const [companies, tasks] = await Promise.all([
    db.company.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.task.findMany({
      where: { OR: [{ status: { not: "DONE" } }, { updatedAt: { gte: new Date(Date.now() - 7 * 86400000) } }] },
      orderBy: [{ forAdmin: "desc" }, { priority: "asc" }, { createdAt: "desc" }],
      include: { company: { select: { name: true } }, lead: { select: { id: true, name: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="Tarefas" subtitle="⚠️ = pendência que um funcionário de IA escalou para você decidir" />
      <Collapsible title="Nova tarefa">
        <form action={createTask} className="grid gap-3 md:grid-cols-5">
          <input name="title" required placeholder="Tarefa" className="input md:col-span-2" />
          <select name="companyId" className="input">
            <option value="">Sem empresa</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="dueDate" type="date" className="input" />
          <select name="priority" defaultValue="2" className="input"><option value="1">Alta</option><option value="2">Normal</option><option value="3">Baixa</option></select>
          <textarea name="description" placeholder="Detalhes" className="input md:col-span-4" rows={2} />
          <SubmitButton>Criar</SubmitButton>
        </form>
      </Collapsible>
      <div className="grid gap-4 md:grid-cols-3">
        {COLS.map((col) => (
          <div key={col.status}>
            <div className="mb-2 px-1 text-sm font-medium">{col.label}</div>
            <div className="space-y-2">
              {tasks.filter((t) => t.status === col.status).map((t) => (
                <div key={t.id} className={`rounded-lg border bg-white p-3 shadow-sm ${t.forAdmin ? "border-rose-200" : "border-slate-200"}`}>
                  <div className="text-sm font-medium">{t.forAdmin ? "⚠️ " : t.priority === 1 ? "🔴 " : ""}{t.title}</div>
                  {t.description && <div className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{t.description}</div>}
                  <div className="mt-2 text-xs text-slate-400">
                    {t.company && <Link href={`/empresas/${t.companyId}`} className="hover:underline">{t.company.name} · </Link>}
                    {t.lead && <Link href={`/prospeccao/${t.lead.id}`} className="hover:underline">{t.lead.name} · </Link>}
                    {t.createdBy} · {date(t.createdAt)}{t.dueDate ? ` · prazo ${date(t.dueDate)}` : ""}
                  </div>
                  <div className="mt-2 flex gap-1">
                    {COLS.filter((c) => c.status !== t.status).map((c) => (
                      <form key={c.status} action={setTaskStatus.bind(null, t.id, c.status)}>
                        <SubmitButton className="btn-secondary btn-sm" pending="...">{c.label}</SubmitButton>
                      </form>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
