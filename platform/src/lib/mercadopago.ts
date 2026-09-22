// Cobrança com Mercado Pago: link de pagamento (Pix, boleto e cartão) + Pix copia e cola,
// envio ao cliente pelo WhatsApp e baixa automática via webhook.
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { logActivity } from "./activity";
import { sendWhatsApp } from "./whatsapp";
import { AGENCY_NAME, appUrl, date, money, zonedParts } from "./utils";

const API = () => (process.env.MP_API_BASE || "https://api.mercadopago.com").replace(/\/$/, "");

export function mercadoPagoEnabled() {
  return Boolean(process.env.MP_ACCESS_TOKEN);
}

async function mp<T>(path: string, init: { method?: string; body?: unknown; idempotencyKey?: string } = {}) {
  const res = await fetch(`${API()}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(`Mercado Pago ${res.status}: ${json.message ?? JSON.stringify(json).slice(0, 300)}`);
  return json as T;
}

/** Fim do dia de vencimento + 5 dias de tolerância, no formato exigido pelo Mercado Pago. */
function expiration(due: Date) {
  const d = zonedParts(new Date(due.getTime() + 5 * 86400000));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.year}-${pad(d.month)}-${pad(d.day)}T23:59:59.000-03:00`;
}

/** Cria a cobrança no Mercado Pago (link + Pix quando o cliente tem e-mail). Idempotente por fatura. */
export async function createCharge(invoiceId: string) {
  if (!mercadoPagoEnabled()) throw new Error("Mercado Pago não configurado (MP_ACCESS_TOKEN).");
  const invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { company: true } });
  if (invoice.status === "PAID" || invoice.status === "CANCELED") throw new Error("Fatura já paga ou cancelada.");
  const amount = Number(invoice.amount);
  const notificationUrl = appUrl("/api/webhooks/mercadopago");
  const data: Record<string, string | null> = {};

  if (!invoice.mpPreferenceId) {
    const pref = await mp<{ id: string; init_point: string }>("/checkout/preferences", {
      method: "POST",
      body: {
        items: [
          {
            id: invoice.id,
            title: `${AGENCY_NAME} — ${invoice.description}`,
            quantity: 1,
            currency_id: "BRL",
            unit_price: amount,
          },
        ],
        payer: invoice.company.email ? { email: invoice.company.email, name: invoice.company.contactName ?? undefined } : undefined,
        external_reference: invoice.id,
        notification_url: notificationUrl,
        statement_descriptor: AGENCY_NAME.slice(0, 13),
        expires: true,
        expiration_date_to: expiration(invoice.dueDate),
      },
    });
    data.mpPreferenceId = pref.id;
    data.paymentLink = pref.init_point;
  }

  if (!invoice.pixCode && invoice.company.email) {
    try {
      const pay = await mp<{
        id: number;
        point_of_interaction?: { transaction_data?: { qr_code?: string; qr_code_base64?: string; ticket_url?: string } };
      }>("/v1/payments", {
        method: "POST",
        idempotencyKey: `pix-${invoice.id}`,
        body: {
          transaction_amount: amount,
          description: `${AGENCY_NAME} — ${invoice.description}`,
          payment_method_id: "pix",
          payer: { email: invoice.company.email },
          external_reference: invoice.id,
          notification_url: notificationUrl,
          date_of_expiration: expiration(invoice.dueDate),
        },
      });
      const tx = pay.point_of_interaction?.transaction_data;
      data.mpPaymentId = String(pay.id);
      data.pixCode = tx?.qr_code ?? null;
      data.pixQrBase64 = tx?.qr_code_base64 ?? null;
    } catch (err) {
      // o link de pagamento continua funcionando com Pix; só não teremos o copia e cola direto
      console.error("[mercadopago] Pix direto falhou", err);
    }
  }

  const updated = await db.invoice.update({ where: { id: invoice.id }, data });
  await logActivity({
    type: "invoice.charge",
    summary: `Cobrança gerada no Mercado Pago: ${invoice.company.name} ${money(invoice.amount)}`,
    companyId: invoice.companyId,
  });
  return updated;
}

type ChargeMessage = "new" | "reminder" | "overdue";

/** Envia a cobrança ao cliente pelo WhatsApp (gera no Mercado Pago antes, se preciso). */
export async function sendInvoice(invoiceId: string, kind: ChargeMessage = "new", actor = "SYSTEM") {
  let invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { company: true } });
  const phone = invoice.company.whatsapp;
  if (!phone) throw new Error(`${invoice.company.name} não tem WhatsApp cadastrado.`);
  if (mercadoPagoEnabled() && !invoice.paymentLink) {
    await createCharge(invoice.id);
    invoice = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { company: true } });
  }
  const first = invoice.company.contactName?.split(" ")[0];
  const intro: Record<ChargeMessage, string> = {
    new: `Olá${first ? `, ${first}` : ""}! Segue a cobrança de *${invoice.description}* (${money(invoice.amount)}), com vencimento em ${date(invoice.dueDate)}.`,
    reminder: `Olá${first ? `, ${first}` : ""}! Passando para lembrar que *${invoice.description}* (${money(invoice.amount)}) vence em ${date(invoice.dueDate)} 🙂`,
    overdue: `Olá${first ? `, ${first}` : ""}! Notamos que *${invoice.description}* (${money(invoice.amount)}) venceu em ${date(invoice.dueDate)}. Se já pagou, desconsidere 🙏`,
  };
  const lines = [intro[kind]];
  if (invoice.paymentLink) lines.push("", `Pague por Pix, boleto ou cartão: ${invoice.paymentLink}`);
  const result = await sendWhatsApp({ phone, text: lines.join("\n"), author: actor });
  // Pix copia e cola em mensagem separada, para o cliente copiar com um toque
  if (invoice.pixCode) {
    await sendWhatsApp({ phone, text: "Pix copia e cola 👇", author: actor });
    await sendWhatsApp({ phone, text: invoice.pixCode, author: actor });
  }
  const now = new Date();
  await db.invoice.update({
    where: { id: invoice.id },
    data: kind === "new" ? { sentAt: now } : kind === "reminder" ? { dueReminderAt: now } : { remindedAt: now },
  });
  return { ok: result.ok, dryRun: result.dryRun ?? false, paymentLink: invoice.paymentLink };
}

/** Valida a assinatura x-signature do webhook (quando MP_WEBHOOK_SECRET estiver definido). */
export function validMercadoPagoSignature(req: Request, dataId: string) {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return true;
  const header = req.headers.get("x-signature") ?? "";
  const requestId = req.headers.get("x-request-id") ?? "";
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  if (!parts.ts || !parts.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${id};request-id:${requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256", secret).update(manifest).digest("hex");
  return expected.length === parts.v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1));
}

/**
 * Processa a notificação de pagamento. O status é sempre consultado na API do Mercado Pago
 * (nunca confiamos no corpo do webhook), então uma notificação falsa não baixa fatura.
 */
export async function handlePaymentNotification(paymentId: string) {
  const payment = await mp<{
    id: number;
    status: string;
    external_reference?: string;
    transaction_amount: number;
    payment_method_id?: string;
    payment_type_id?: string;
  }>(`/v1/payments/${encodeURIComponent(paymentId)}`).catch((err: Error) => {
    if (/Mercado Pago 404/.test(err.message)) return null; // pagamento de outra conta/teste: ignorar
    throw err;
  });
  if (!payment) return { ignored: true };
  if (!payment.external_reference) return { ignored: true };
  const invoice = await db.invoice.findUnique({ where: { id: payment.external_reference }, include: { company: true } });
  if (!invoice) return { ignored: true };

  if (payment.status === "approved" && invoice.status !== "PAID") {
    if (Math.abs(payment.transaction_amount - Number(invoice.amount)) > 0.01) {
      await logActivity({
        type: "invoice.amount_mismatch",
        summary: `⚠️ Pagamento de ${money(payment.transaction_amount)} difere da fatura ${money(invoice.amount)} (${invoice.company.name})`,
        companyId: invoice.companyId,
      });
    }
    await db.invoice.update({
      where: { id: invoice.id },
      data: { status: "PAID", paidAt: new Date(), mpPaymentId: String(payment.id), paidVia: payment.payment_method_id ?? payment.payment_type_id },
    });
    await logActivity({
      type: "invoice.paid",
      summary: `💰 Pagamento recebido: ${invoice.company.name} ${money(invoice.amount)} (${payment.payment_method_id ?? "Mercado Pago"})`,
      companyId: invoice.companyId,
    });
    if (invoice.company.whatsapp) {
      await sendWhatsApp({
        phone: invoice.company.whatsapp,
        author: "SYSTEM",
        text: `Pagamento de *${invoice.description}* confirmado ✅ Obrigado!`,
      });
    }
    return { paid: true };
  }
  return { status: payment.status };
}

