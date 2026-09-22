// Rotina automática: follow-ups, vídeos, cobranças, contratos. Chame a cada 5–10 min (cron do Railway, cron-job.org...).
import { tick } from "@/lib/automation";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function handle(req: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(req.url);
  const provided = url.searchParams.get("secret") ?? req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || provided !== secret) return new Response("forbidden", { status: 403 });
  const report = await tick();
  return Response.json({ ok: true, report });
}

export const GET = handle;
export const POST = handle;
