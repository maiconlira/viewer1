// Rotina automática (chamada a cada poucos minutos por /api/cron/tick ou pelo worker).
import { db } from "./db";
import { logActivity } from "./activity";
import { pollPendingVideos } from "./media";
import { runFollowUps } from "./agents/whatsapp-agent";
import { escalateToAdmin } from "./services";
import { sendWhatsApp } from "./whatsapp";
import { aiEnabled } from "./claude";
import { date, money } from "./utils";

let running = false;

export async function tick() {
  if (running) return { skipped: true };
  running = true;
  const report: Record<string, number> = {};
  try {
    // 1. Postagens aprovadas com data → agendadas
    const scheduled = await db.post.updateMany({
      where: { status: "APPROVED", scheduledAt: { not: null } },
      data: { status: "SCHEDULED" },
    });
    report.postsScheduled = scheduled.count;

    // 2. Vídeos em processamento
    report.videosReady = await pollPendingVideos();

    // 3. Follow-ups de prospecção
    report.followUps = aiEnabled() ? await runFollowUps() : 0;

    // 4. Cobranças vencidas → marca e lembra o cliente uma vez
    const overdue = await db.invoice.findMany({
      where: { status: "PENDING", dueDate: { lt: new Date(Date.now() - 86400000) } },
      include: { company: true },
    });
    for (const inv of overdue) {
      await db.invoice.update({ where: { id: inv.id }, data: { status: "OVERDUE" } });
      if (inv.company.whatsapp && !inv.remindedAt) {
        await sendWhatsApp({
          phone: inv.company.whatsapp,
          author: "SYSTEM",
          text:
            `Olá${inv.company.contactName ? `, ${inv.company.contactName.split(" ")[0]}` : ""}! Passando para lembrar da fatura ` +
            `"${inv.description}" (${money(inv.amount)}) que venceu em ${date(inv.dueDate)}.` +
            (inv.paymentLink ? `\nLink para pagamento: ${inv.paymentLink}` : "") +
            `\nSe já pagou, desconsidere 🙏`,
        });
        await db.invoice.update({ where: { id: inv.id }, data: { remindedAt: new Date() } });
      }
      await logActivity({ type: "invoice.overdue", summary: `Fatura vencida: ${inv.company.name} ${money(inv.amount)}`, companyId: inv.companyId });
    }
    report.invoicesOverdue = overdue.length;

    // 5. Contratos vencendo em 30 dias → pendência para o dono (uma vez)
    const expiring = await db.contract.findMany({
      where: { status: "SIGNED", endDate: { lte: new Date(Date.now() + 30 * 86400000), gte: new Date() } },
      include: { company: true },
    });
    for (const c of expiring) {
      const exists = await db.task.findFirst({ where: { title: `Renovar contrato: ${c.company.name}`, status: { not: "DONE" } } });
      if (!exists) {
        await escalateToAdmin({
          title: `Renovar contrato: ${c.company.name}`,
          description: `"${c.title}" termina em ${date(c.endDate)}.`,
          companyId: c.companyId,
          actor: "SYSTEM",
        });
      }
    }
    await db.contract.updateMany({ where: { status: "SIGNED", endDate: { lt: new Date() } }, data: { status: "EXPIRED" } });

    return report;
  } finally {
    running = false;
  }
}
