// Camada de WhatsApp com dois provedores:
//  - evolution: Evolution API (self-hosted, conecta o número via QR Code)
//  - meta: WhatsApp Cloud API oficial
//  - none: modo simulação — nada sai, mas tudo é registrado no painel
import { db } from "./db";
import { normalizePhone } from "./utils";

export type WhatsAppProvider = "evolution" | "meta" | "none";

export function whatsappProvider(): WhatsAppProvider {
  const p = (process.env.WHATSAPP_PROVIDER || "none").toLowerCase();
  if (p === "evolution" || p === "meta") return p;
  return "none";
}

type SendResult = { ok: boolean; externalId?: string; error?: string; dryRun?: boolean };

async function sendViaEvolution(phone: string, text: string, mediaUrl?: string): Promise<SendResult> {
  const base = (process.env.EVOLUTION_API_URL || "").replace(/\/$/, "");
  const instance = process.env.EVOLUTION_INSTANCE;
  const apikey = process.env.EVOLUTION_API_KEY || "";
  if (!base || !instance) return { ok: false, error: "Evolution API não configurada" };

  const isVideo = mediaUrl ? /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl) : false;
  const endpoint = mediaUrl ? `${base}/message/sendMedia/${instance}` : `${base}/message/sendText/${instance}`;
  const body = mediaUrl
    ? { number: phone, mediatype: isVideo ? "video" : "image", media: mediaUrl, caption: text }
    : { number: phone, text };

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { key?: { id?: string }; message?: unknown };
  if (!res.ok) return { ok: false, error: `Evolution ${res.status}: ${JSON.stringify(json).slice(0, 300)}` };
  return { ok: true, externalId: json.key?.id };
}

async function sendViaMeta(phone: string, text: string, mediaUrl?: string): Promise<SendResult> {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_NUMBER_ID;
  if (!token || !phoneId) return { ok: false, error: "WhatsApp Cloud API não configurada" };

  const isVideo = mediaUrl ? /\.(mp4|mov|webm)(\?|$)/i.test(mediaUrl) : false;
  const payload = mediaUrl
    ? {
        messaging_product: "whatsapp",
        to: phone,
        type: isVideo ? "video" : "image",
        [isVideo ? "video" : "image"]: { link: mediaUrl, caption: text },
      }
    : { messaging_product: "whatsapp", to: phone, type: "text", text: { body: text, preview_url: true } };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[] };
  if (!res.ok) return { ok: false, error: `Meta ${res.status}: ${JSON.stringify(json).slice(0, 300)}` };
  return { ok: true, externalId: json.messages?.[0]?.id };
}

/** Garante uma conversa para o telefone, ligando a empresa ou lead correspondente. */
export async function getOrCreateConversation(rawPhone: string, contactName?: string) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Telefone inválido");

  const existing = await db.conversation.findUnique({ where: { phone } });
  if (existing) {
    if (contactName && !existing.contactName) {
      return db.conversation.update({ where: { id: existing.id }, data: { contactName } });
    }
    return existing;
  }

  const [company, lead] = await Promise.all([
    db.company.findUnique({ where: { whatsapp: phone } }),
    db.lead.findUnique({ where: { phone } }),
  ]);

  return db.conversation.create({
    data: {
      phone,
      contactName: contactName ?? company?.contactName ?? lead?.name,
      companyId: company?.id,
      leadId: company ? undefined : lead?.id,
      agentId: lead?.agentId ?? undefined,
    },
  });
}

/**
 * Envia uma mensagem e registra no histórico da conversa.
 * `author` identifica quem falou: ADMIN, SYSTEM ou AI:<nome do agente>.
 */
export async function sendWhatsApp(opts: {
  phone: string;
  text: string;
  mediaUrl?: string;
  author?: string;
  conversationId?: string;
}) {
  const phone = normalizePhone(opts.phone);
  if (!phone) throw new Error("Telefone inválido");
  const conversation = opts.conversationId
    ? await db.conversation.findUniqueOrThrow({ where: { id: opts.conversationId } })
    : await getOrCreateConversation(phone);

  const provider = whatsappProvider();
  let result: SendResult;
  try {
    if (provider === "evolution") result = await sendViaEvolution(phone, opts.text, opts.mediaUrl);
    else if (provider === "meta") result = await sendViaMeta(phone, opts.text, opts.mediaUrl);
    else result = { ok: true, dryRun: true };
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const message = await db.message.create({
    data: {
      conversationId: conversation.id,
      direction: "OUT",
      author: opts.author ?? "SYSTEM",
      body: opts.text,
      mediaUrl: opts.mediaUrl,
      externalId: result.externalId,
      status: result.dryRun ? "DRY_RUN" : result.ok ? "SENT" : "FAILED",
      error: result.error,
    },
  });
  await db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });

  if (!result.ok) console.error("[whatsapp] falha ao enviar", result.error);
  return { ...result, message, conversation };
}

export type InboundMessage = {
  phone: string;
  text: string;
  contactName?: string;
  externalId?: string;
  mediaUrl?: string;
};

/** Extrai mensagens recebidas do payload do webhook da Evolution API. */
export function parseEvolutionWebhook(body: unknown): InboundMessage[] {
  const b = body as {
    event?: string;
    data?: unknown;
  };
  const event = (b.event || "").toLowerCase().replace("_", ".");
  if (event !== "messages.upsert") return [];
  const items = Array.isArray(b.data) ? b.data : [b.data];
  const out: InboundMessage[] = [];
  for (const raw of items) {
    const d = raw as {
      key?: { remoteJid?: string; fromMe?: boolean; id?: string };
      pushName?: string;
      message?: {
        conversation?: string;
        extendedTextMessage?: { text?: string };
        imageMessage?: { caption?: string };
        videoMessage?: { caption?: string };
        buttonsResponseMessage?: { selectedDisplayText?: string };
        listResponseMessage?: { title?: string };
      };
    };
    if (!d?.key?.remoteJid || d.key.fromMe) continue;
    if (d.key.remoteJid.endsWith("@g.us")) continue; // ignora grupos
    const m = d.message ?? {};
    const text =
      m.conversation ??
      m.extendedTextMessage?.text ??
      m.imageMessage?.caption ??
      m.videoMessage?.caption ??
      m.buttonsResponseMessage?.selectedDisplayText ??
      m.listResponseMessage?.title ??
      (m.imageMessage ? "[imagem]" : m.videoMessage ? "[vídeo]" : "[mensagem sem texto]");
    out.push({
      phone: d.key.remoteJid.split("@")[0],
      text,
      contactName: d.pushName,
      externalId: d.key.id,
    });
  }
  return out;
}

/** Extrai mensagens recebidas do payload do webhook da WhatsApp Cloud API. */
export function parseMetaWebhook(body: unknown): InboundMessage[] {
  const b = body as {
    entry?: {
      changes?: {
        value?: {
          contacts?: { wa_id: string; profile?: { name?: string } }[];
          messages?: {
            from: string;
            id: string;
            type: string;
            text?: { body: string };
            button?: { text: string };
            interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
            image?: { caption?: string };
          }[];
        };
      }[];
    }[];
  };
  const out: InboundMessage[] = [];
  for (const entry of b.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const msg of value?.messages ?? []) {
        const contact = value?.contacts?.find((c) => c.wa_id === msg.from);
        const text =
          msg.text?.body ??
          msg.button?.text ??
          msg.interactive?.button_reply?.title ??
          msg.interactive?.list_reply?.title ??
          msg.image?.caption ??
          `[${msg.type}]`;
        out.push({ phone: msg.from, text, contactName: contact?.profile?.name, externalId: msg.id });
      }
    }
  }
  return out;
}
