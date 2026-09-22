import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Collapsible, Empty, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CompanyFields } from "@/components/forms";
import { createCompany } from "../../actions";
import { companyStatusLabel, money } from "@/lib/utils";

const statusColor = {
  ONBOARDING: "bg-sky-100 text-sky-800",
  ACTIVE: "bg-emerald-100 text-emerald-800",
  PAUSED: "bg-amber-100 text-amber-800",
  CHURNED: "bg-slate-200 text-slate-600",
};

export default async function Empresas() {
  const companies = await db.company.findMany({
    orderBy: [{ status: "asc" }, { name: "asc" }],
    include: {
      _count: {
        select: {
          posts: { where: { status: { in: ["PENDING_APPROVAL", "CHANGES_REQUESTED"] } } },
          invoices: { where: { status: "OVERDUE" } },
          tasks: { where: { status: { not: "DONE" } } },
        },
      },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Empresas" subtitle={`${companies.length} clientes na carteira`} />
      <Collapsible title="Cadastrar empresa">
        <form action={createCompany} className="space-y-4">
          <CompanyFields />
          <SubmitButton>Cadastrar</SubmitButton>
        </form>
      </Collapsible>

      {companies.length === 0 ? (
        <Empty>Nenhuma empresa cadastrada.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {companies.map((c) => (
            <Link key={c.id} href={`/empresas/${c.id}`} className="card transition hover:border-brand-300">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{c.name}</div>
                  <div className="muted">{c.segment ?? "—"}</div>
                </div>
                <Badge className={statusColor[c.status]}>{companyStatusLabel[c.status]}</Badge>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                {c.monthlyFee && <Badge>{money(c.monthlyFee)}/mês</Badge>}
                {c._count.posts > 0 && <Badge className="bg-amber-100 text-amber-800">{c._count.posts} em aprovação</Badge>}
                {c._count.invoices > 0 && <Badge className="bg-rose-100 text-rose-800">{c._count.invoices} fatura vencida</Badge>}
                {c._count.tasks > 0 && <Badge>{c._count.tasks} tarefas</Badge>}
                {!c.whatsapp && <Badge className="bg-rose-50 text-rose-700">sem WhatsApp</Badge>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
