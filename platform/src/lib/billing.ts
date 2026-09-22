// Faturamento recorrente: gera as mensalidades, cria a cobrança no Mercado Pago e envia ao cliente.
import { db } from "./db";
import { logActivity } from "./activity";
import { createCharge, mercadoPagoEnabled, sendInvoice } from "./mercadopago";
import { getOption } from "./settings";
import { zonedParts, zonedTime } from "./utils";

function monthRef(d: Date) {
  const p = zonedParts(d);
  return `${String(p.month).padStart(2, "0")}/${p.year}`;
}

/**
 * Cria as mensalidades do mês corrente.
 * - manual (force=true): cria para todos os clientes ativos agora.
 * - automático: cria quando faltam `invoice_reminder_days` dias (ou menos) para o vencimento.
 * Com Mercado Pago e auto_charge=on, gera a cobrança e envia pelo WhatsApp.
 */
export async function ensureMonthlyInvoices(opts: { force?: boolean; send?: boolean } = {}) {
  const now = new Date();
  const leadDays = Number(await getOption("invoice_reminder_days")) || 3;
  const autoCharge = (await getOption("auto_charge")) === "on" && mercadoPagoEnabled();
  const companies = await db.company.findMany({
    where: { status: { in: ["ACTIVE", "ONBOARDING"] }, monthlyFee: { not: null } },
  });
  const description = `Mensalidade ${monthRef(now)}`;
  const today = zonedParts(now);
  let created = 0;
  for (const c of companies) {
    const due = zonedTime(today.year, today.month, c.billingDay ?? 10, 12, 0);
    const untilDue = due.getTime() - now.getTime();
    // automático: só dentro da janela de antecedência e antes de vencer (atrasadas ficam para o botão manual)
    if (!opts.force && (untilDue > leadDays * 86400_000 || untilDue < 0)) continue;
    const exists = await db.invoice.findFirst({ where: { companyId: c.id, description } });
    if (exists) continue;
    const inv = await db.invoice.create({
      data: { companyId: c.id, description, amount: c.monthlyFee!, dueDate: due },
    });
    created++;
    if (autoCharge) {
      try {
        await createCharge(inv.id);
        if (opts.send !== false && c.whatsapp) await sendInvoice(inv.id, "new");
      } catch (err) {
        console.error("[billing] cobrança automática falhou", c.name, err);
      }
    }
  }
  if (created) await logActivity({ type: "invoice.batch", summary: `${created} mensalidade(s) geradas (${monthRef(now)})` });
  return created;
}

/** Lembretes: antes do vencimento (para quem ainda não recebeu) e após vencer (uma vez). */
export async function runInvoiceReminders() {
  const now = new Date();
  const leadDays = Number(await getOption("invoice_reminder_days")) || 3;
  let sent = 0;

  // A vencer — só para faturas já enviadas há mais de 1 dia, sem lembrete ainda
  const upcoming = await db.invoice.findMany({
    where: {
      status: "PENDING",
      dueReminderAt: null,
      dueDate: { gte: now, lte: new Date(now.getTime() + Math.min(leadDays, 2) * 86400_000) },
      OR: [{ sentAt: null }, { sentAt: { lt: new Date(now.getTime() - 86400_000) } }],
      company: { whatsapp: { not: null } },
    },
    take: 30,
  });
  for (const inv of upcoming) {
    try {
      await sendInvoice(inv.id, inv.sentAt ? "reminder" : "new");
      if (!inv.sentAt) await db.invoice.update({ where: { id: inv.id }, data: { dueReminderAt: new Date() } });
      sent++;
    } catch (err) {
      console.error("[billing] lembrete", inv.id, err);
    }
  }

  // Vencidas — marca e lembra uma vez
  const overdue = await db.invoice.findMany({
    where: { status: "PENDING", dueDate: { lt: new Date(now.getTime() - 86400_000) } },
    include: { company: true },
    take: 30,
  });
  for (const inv of overdue) {
    await db.invoice.update({ where: { id: inv.id }, data: { status: "OVERDUE" } });
    await logActivity({ type: "invoice.overdue", summary: `Fatura vencida: ${inv.company.name}`, companyId: inv.companyId });
    if (inv.company.whatsapp && !inv.remindedAt) {
      try {
        await sendInvoice(inv.id, "overdue");
        sent++;
      } catch (err) {
        console.error("[billing] atraso", inv.id, err);
      }
    }
  }
  return sent;
}
