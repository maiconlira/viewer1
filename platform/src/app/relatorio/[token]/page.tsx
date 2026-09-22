import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ReportView } from "@/components/report-view";
import { AGENCY_NAME } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RelatorioPublico({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const report = await db.report.findUnique({ where: { publicToken: token }, include: { company: { select: { name: true } } } });
  if (!report || report.status !== "SENT") notFound();
  return (
    <div className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="text-center text-sm text-slate-500">{AGENCY_NAME} · relatório de desempenho</div>
        <div className="rounded-2xl bg-white p-6 shadow md:p-8">
          <ReportView report={report} companyName={report.company.name} />
        </div>
      </div>
    </div>
  );
}
