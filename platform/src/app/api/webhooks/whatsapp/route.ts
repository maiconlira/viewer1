// Webhook único para Evolution API e WhatsApp Cloud API (Meta).
// Evolution: configure a URL {APP_URL}/api/webhooks/whatsapp?secret=WEBHOOK_SECRET com o evento MESSAGES_UPSERT.
// Meta: mesma URL como callback, com META_WA_VERIFY_TOKEN como token de verificação.
import { createHmac, timingSafeEqual } from "node:crypto";
import { handleInbound } from "@/lib/agents/whatsapp-agent";
import { parseEvolutionWebhook, parseMetaWebhook, type InboundMessage } from "@/lib/whatsapp";

export const dynamic = "force-dynamic";

// Verificação do webhook da Meta
export function GET(req: Request) {
  const url = new URL(req.url);
  if (
    url.searchParams.get("hub.mode") === "subscribe" &&
    url.searchParams.get("hub.verify_token") === process.env.META_WA_VERIFY_TOKEN &&
    process.env.META_WA_VERIFY_TOKEN
  ) {
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("forbidden", { status: 403 });
}

async function validMetaSignature(raw: string, header: string | null) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !header) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(raw).digest("hex");
  return expected.length === header.length && timingSafeEqual(Buffer.from(expected), Buffer.from(header));
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const raw = await req.text();

  // Autenticação: assinatura da Meta (META_APP_SECRET) ou ?secret=WEBHOOK_SECRET na URL.
  const secret = process.env.WEBHOOK_SECRET;
  const signed = await validMetaSignature(raw, req.headers.get("x-hub-signature-256"));
  if (!signed && secret && url.searchParams.get("secret") !== secret) {
    return new Response("forbidden", { status: 403 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false }, { status: 400 });
  }

  const messages: InboundMessage[] = (body as { object?: string }).object === "whatsapp_business_account"
    ? parseMetaWebhook(body)
    : parseEvolutionWebhook(body);

  // Responde rápido ao provedor; a IA processa em segundo plano, em ordem.
  void (async () => {
    for (const m of messages) {
      try {
        await handleInbound(m);
      } catch (err) {
        console.error("[webhook] erro ao processar mensagem", err);
      }
    }
  })();

  return Response.json({ ok: true, received: messages.length });
}
