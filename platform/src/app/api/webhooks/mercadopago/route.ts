// Notificações de pagamento do Mercado Pago (Webhooks e IPN legado).
import { handlePaymentNotification, mercadoPagoEnabled, validMercadoPagoSignature } from "@/lib/mercadopago";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!mercadoPagoEnabled()) return new Response("disabled", { status: 404 });
  const url = new URL(req.url);
  const body = (await req.json().catch(() => ({}))) as { type?: string; topic?: string; data?: { id?: string | number } };
  const type = body.type ?? url.searchParams.get("type") ?? url.searchParams.get("topic");
  const id = String(body.data?.id ?? url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "");
  if (type !== "payment" || !id) return Response.json({ ignored: true });
  if (!validMercadoPagoSignature(req, url.searchParams.get("data.id") ?? id)) return new Response("invalid signature", { status: 401 });
  try {
    return Response.json(await handlePaymentNotification(id));
  } catch (err) {
    console.error("[mercadopago webhook]", err);
    return new Response("error", { status: 500 }); // o Mercado Pago tenta de novo
  }
}
