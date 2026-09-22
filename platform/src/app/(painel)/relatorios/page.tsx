import Link from "next/link";
import { db } from "@/lib/db";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { SubmitButton } from "@/components/client";
import { CompanyFilter } from "@/components/company-filter";
import { generateReportAction } from "../../actions";
import { periodLabel, previousPeriod } from "@/lib/reports";
import { getOption } from "@/lib/settings";
import { date } from "@/lib/utils";

export default async function Relatorios({ searchParams }: { searchParams: Promise<{ companyId?: string }> }) {
  const { companyId } = await searchParams;
  const [companies, reports, mode] = await Promise.all([
    db.company.findMany({ where: { status: { not: "CHURNED" } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.report.findMany({
      where: { companyId: companyId || undefined },
      orderBy: [{ period: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { company: { select: { name: true } } },
    }),
    getOption("reports_mode"),
  ]);
  const modeLabel = { off: "desligada", draft: "gera rascunhos no dia 1 para você revisar", send: "gera e envia sozinho no dia 1" }[mode] ?? mode;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatórios"
        subtitle={`Relatórios mensais de desempenho com análise da IA. Rotina automática: ${modeLabel}.`}
        actions={<CompanyFilter companies={companies} current={companyId} />}
      />
      <Section title="Gerar relatório">
        <form action={generateReportAction} className="flex flex-wrap gap-2">
          <select name="companyId" required defaultValue={companyId ?? ""} className="input w-64">
            <option value="" disabled>Empresa...</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input name="period" type="month" required defaultValue={previousPeriod()} className="input w-44" />
          <SubmitButton className="btn-ai" pending="Coletando métricas e analisando...">📊 Gerar com IA</SubmitButton>
        </form>
      </Section>
      {reports.length === 0 ? <Empty>Nenhum relatório.</Empty> : (
        <Section title="Todos">
          <table className="table">
            <thead><tr><th>Empresa</th><th>Mês</th><th>Destaque</th><th>Status</th></tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td>{r.company.name}</td>
                  <td><Link href={`/relatorios/${r.id}`} className="link">{periodLabel(r.period)}</Link></td>
                  <td className="max-w-md truncate text-slate-600">{r.headline}</td>
                  <td>
                    <Badge className={r.status === "SENT" ? "bg-emerald-100 text-emerald-800" : undefined}>
                      {r.status === "SENT" ? `Enviado ${date(r.sentAt)}` : "Rascunho"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </div>
  );
}
