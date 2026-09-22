// Relatórios mensais por cliente: métricas do Instagram + produção da agência, analisados pela IA
// e entregues ao cliente por WhatsApp com link para a versão completa.
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "./db";
import { logActivity } from "./activity";
import { aiEnabled, generateJSON } from "./claude";
import { instagramStats, type InstagramMonthStats } from "./meta";
import { escalateToAdmin } from "./services";
import { getOption } from "./settings";
import { sendWhatsApp } from "./whatsapp";
import { AGENCY_NAME, appUrl, TZ, zonedParts, zonedTime } from "./utils";

export function periodRange(period: string) {
  const [y, m] = period.split("-").map(Number);
  return { since: zonedTime(y, m, 1), until: zonedTime(y, m + 1, 1) };
}

export function periodLabel(period: string) {
  const { since } = periodRange(period);
  const label = new Date(since.getTime() + 12 * 3600_000).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: TZ });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function previousPeriod(d = new Date()) {
  const now = zonedParts(d);
  const y = now.month === 1 ? now.year - 1 : now.year;
  const m = now.month === 1 ? 12 : now.month - 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export type ReportMetrics = {
  period: string;
  production: {
    published: number;
    byFormat: Record<string, number>;
    approved: number;
    changesRequested: number;
    avgApprovalHours: number | null;
    ideasFromClient: number;
  };
  instagram: InstagramMonthStats | null;
  followersGrowth: number | null;
};

export async function buildMetrics(companyId: string, period: string): Promise<ReportMetrics> {
  const { since, until } = periodRange(period);
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const [published, approved, changes, ideas, prev] = await Promise.all([
    db.post.findMany({ where: { companyId, publishedAt: { gte: since, lt: until } }, select: { format: true } }),
    db.post.findMany({
      where: { companyId, approvedAt: { gte: since, lt: until } },
      select: { approvedAt: true, sentForApprovalAt: true },
    }),
    db.activity.count({ where: { companyId, type: "post.changes_requested", createdAt: { gte: since, lt: until } } }),
    db.idea.count({ where: { companyId, source: "CLIENT", createdAt: { gte: since, lt: until } } }),
    db.report.findFirst({ where: { companyId, period: { lt: period } }, orderBy: { period: "desc" } }),
  ]);

  const byFormat: Record<string, number> = {};
  for (const p of published) byFormat[p.format] = (byFormat[p.format] ?? 0) + 1;
  const turnarounds = approved
    .filter((p) => p.approvedAt && p.sentForApprovalAt)
    .map((p) => (p.approvedAt!.getTime() - p.sentForApprovalAt!.getTime()) / 3600_000)
    .filter((h) => h >= 0);

  const instagram = company.igUserId && company.metaToken ? await instagramStats(company, since, until) : null;
  const prevFollowers = (prev?.metrics as ReportMetrics | undefined)?.instagram?.followers;
  const followersGrowth = instagram?.followers != null && prevFollowers != null ? instagram.followers - prevFollowers : null;

  return {
    period,
    production: {
      published: published.length,
      byFormat,
      approved: approved.length,
      changesRequested: changes,
      avgApprovalHours: turnarounds.length ? Math.round((turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length) * 10) / 10 : null,
      ideasFromClient: ideas,
    },
    instagram,
    followersGrowth,
  };
}

const ReportAI = z.object({
  headline: z.string().describe("Uma frase de destaque do mês, positiva e honesta"),
  whatsapp_summary: z.string().describe("Resumo para WhatsApp: 4 a 7 linhas curtas, com 2-3 números principais, tom próximo"),
  analysis: z.string().describe("Análise completa em texto simples com parágrafos: o que funcionou, o que não funcionou e por quê"),
  highlights: z.array(z.string()).describe("3 a 5 destaques curtos com números"),
  recommendations: z.array(z.string()).describe("3 a 5 ações concretas para o próximo mês"),
});

export async function generateReport(companyId: string, period: string) {
  if (!aiEnabled()) throw new Error("IA desativada (ANTHROPIC_API_KEY).");
  const company = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  const metrics = await buildMetrics(companyId, period);

  const ai = await generateJSON({
    system: `Você é o analista de performance da agência ${AGENCY_NAME}. Escreve relatórios mensais para donos de pequenos negócios:
linguagem simples, sem jargão, honesta (não esconda números ruins, explique e proponha o que fazer), em português do Brasil.
Use somente os números fornecidos — nunca invente métricas. Se o Instagram não estiver conectado, foque na produção e no processo.`,
    schema: ReportAI,
    prompt: `Cliente: ${company.name}${company.segment ? ` (${company.segment})` : ""}
Mês: ${periodLabel(period)}
${company.brandGuidelines ? `Contexto da marca: ${company.brandGuidelines.slice(0, 500)}` : ""}

Métricas (JSON):
${JSON.stringify(metrics, null, 1).slice(0, 12000)}`,
  });

  const data = {
    metrics: metrics as unknown as Prisma.InputJsonValue,
    headline: ai.headline,
    summary: ai.whatsapp_summary,
    analysis: ai.analysis,
    recommendations: { highlights: ai.highlights, recommendations: ai.recommendations } as Prisma.InputJsonValue,
  };
  const report = await db.report.upsert({
    where: { companyId_period: { companyId, period } },
    update: { ...data, status: "DRAFT" },
    create: { companyId, period, ...data },
  });
  await logActivity({ type: "report.generated", summary: `Relatório de ${periodLabel(period)} gerado: ${company.name}`, companyId });
  return report;
}

export async function sendReport(reportId: string, actor = "SYSTEM") {
  const report = await db.report.findUniqueOrThrow({ where: { id: reportId }, include: { company: true } });
  if (!report.company.whatsapp) throw new Error(`${report.company.name} não tem WhatsApp cadastrado.`);
  const link = appUrl(`/relatorio/${report.publicToken}`);
  const text = [`📊 *Relatório de ${periodLabel(report.period)}*`, "", report.summary ?? report.headline ?? "", "", `Relatório completo: ${link}`].join("\n");
  const r = await sendWhatsApp({ phone: report.company.whatsapp, text, author: actor });
  await db.report.update({ where: { id: report.id }, data: { status: "SENT", sentAt: new Date() } });
  await logActivity({ type: "report.sent", summary: `Relatório de ${periodLabel(report.period)} enviado: ${report.company.name}`, actor, companyId: report.companyId });
  return { ok: r.ok, link };
}

/** Rotina: nos primeiros dias do mês gera (e, conforme configuração, envia) os relatórios do mês anterior. */
export async function runMonthlyReports() {
  const mode = await getOption("reports_mode");
  if (mode === "off" || !aiEnabled() || zonedParts(new Date()).day > 3) return 0;
  const period = previousPeriod();
  const companies = await db.company.findMany({
    where: { status: "ACTIVE", reports: { none: { period } } },
    select: { id: true },
    take: 5, // poucos por execução para não estourar o tempo da rotina
  });
  let generated = 0;
  for (const c of companies) {
    try {
      const report = await generateReport(c.id, period);
      if (mode === "send") await sendReport(report.id);
      generated++;
    } catch (err) {
      console.error("[reports]", c.id, err);
    }
  }
  if (generated && mode === "draft") {
    const title = `Revisar relatórios de ${periodLabel(period)}`;
    const exists = await db.task.findFirst({ where: { title, status: { not: "DONE" } } });
    if (!exists) {
      await escalateToAdmin({
        title,
        description: "Os relatórios foram gerados como rascunho. Revise e envie em Relatórios.",
        actor: "SYSTEM",
      });
    }
  }
  return generated;
}
