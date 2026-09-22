// Rotina automática (chamada a cada poucos minutos por /api/cron/tick ou pelo worker).
// Cada etapa é isolada: uma falha não impede as demais.
import { db } from "./db";
import { pollPendingVideos } from "./media";
import { runFollowUps } from "./agents/whatsapp-agent";
import { escalateToAdmin } from "./services";
import { aiEnabled } from "./claude";
import { runScheduledPublishing } from "./publishing";
import { ensureMonthlyInvoices, runInvoiceReminders } from "./billing";
import { runMeetingReminders } from "./agenda";
import { runMonthlyReports } from "./reports";
import { date } from "./utils";

let running = false;

async function step(report: Record<string, number | string>, name: string, fn: () => Promise<number>) {
  try {
    report[name] = await fn();
  } catch (err) {
    console.error(`[tick] ${name}`, err);
    report[name] = `erro: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function tick() {
  if (running) return { skipped: true };
  running = true;
  const report: Record<string, number | string> = {};
  try {
    // Postagens aprovadas com data → agendadas
    await step(report, "postsScheduled", async () =>
      (await db.post.updateMany({ where: { status: "APPROVED", scheduledAt: { not: null } }, data: { status: "SCHEDULED" } })).count,
    );
    await step(report, "videosReady", pollPendingVideos);
    await step(report, "postsPublished", runScheduledPublishing);
    await step(report, "followUps", async () => (aiEnabled() ? runFollowUps() : 0));
    await step(report, "meetingReminders", runMeetingReminders);
    await step(report, "invoicesCreated", () => ensureMonthlyInvoices());
    await step(report, "invoiceMessages", runInvoiceReminders);
    await step(report, "reports", runMonthlyReports);

    // Contratos vencendo em 30 dias → pendência para o dono (uma vez)
    await step(report, "contracts", async () => {
      const expiring = await db.contract.findMany({
        where: { status: "SIGNED", endDate: { lte: new Date(Date.now() + 30 * 86400000), gte: new Date() } },
        include: { company: true },
      });
      for (const c of expiring) {
        const title = `Renovar contrato: ${c.company.name}`;
        if (!(await db.task.findFirst({ where: { title, status: { not: "DONE" } } }))) {
          await escalateToAdmin({ title, description: `"${c.title}" termina em ${date(c.endDate)}.`, companyId: c.companyId, actor: "SYSTEM" });
        }
      }
      await db.contract.updateMany({ where: { status: "SIGNED", endDate: { lt: new Date() } }, data: { status: "EXPIRED" } });
      return expiring.length;
    });
    return report;
  } finally {
    running = false;
  }
}
