import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Badge, Collapsible, Field, PageHeader } from "@/components/ui";
import { CopyButton, SubmitButton } from "@/components/client";
import { ReportView } from "@/components/report-view";
import { regenerateReport, sendReportAction, updateReport } from "../../../actions";
import { periodLabel, type ReportMetrics } from "@/lib/reports";
import { appUrl, date } from "@/lib/utils";

export default async function RelatorioDetalhe({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await db.report.findUnique({ where: { id }, include: { company: true } });
  if (!report) notFound();
  const link = appUrl(`/relatorio/${report.publicToken}`);
  const errors = (report.metrics as unknown as ReportMetrics).instagram?.errors ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Relatório · ${report.company.name}`}
        subtitle={periodLabel(report.period)}
        actions={
          <>
            <Badge className={report.status === "SENT" ? "bg-emerald-100 text-emerald-800" : undefined}>
              {report.status === "SENT" ? `Enviado ${date(report.sentAt, true)}` : "Rascunho"}
            </Badge>
            <CopyButton text={link} label="Copiar link" />
            <form action={regenerateReport.bind(null, report.id)}>
              <SubmitButton className="btn-secondary" pending="Refazendo...">↻ Refazer</SubmitButton>
            </form>
            <form action={sendReportAction.bind(null, report.id)}>
              <SubmitButton pending="Enviando..." confirm="Enviar este relatório ao cliente pelo WhatsApp?">📲 Enviar ao cliente</SubmitButton>
            </form>
          </>
        }
      />
      {errors.length > 0 && (
        <details className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <summary className="cursor-pointer">Algumas métricas do Instagram não estavam disponíveis ({errors.length})</summary>
          <ul className="mt-2 list-disc pl-5 text-xs">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </details>
      )}
      <div className="card"><ReportView report={report} companyName={report.company.name} /></div>
      <Collapsible title="Editar textos">
        <form key={report.updatedAt.toISOString()} action={updateReport.bind(null, report.id)} className="space-y-3">
          <Field label="Destaque"><input name="headline" defaultValue={report.headline ?? ""} className="input" /></Field>
          <Field label="Resumo enviado no WhatsApp"><textarea name="summary" rows={6} defaultValue={report.summary ?? ""} className="input" /></Field>
          <Field label="Análise"><textarea name="analysis" rows={12} defaultValue={report.analysis ?? ""} className="input" /></Field>
          <SubmitButton>Salvar</SubmitButton>
        </form>
      </Collapsible>
      <Link href="/relatorios" className="link text-sm">← Relatórios</Link>
    </div>
  );
}
