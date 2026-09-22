// Gera URL assinada para upload direto do navegador ao Cloudflare R2 (rota protegida pelo login).
import { z } from "zod";
import { presignUpload, storageEnabled } from "@/lib/storage";

const Body = z.object({
  contentType: z.string(),
  size: z.number().int().positive(),
  folder: z.string().regex(/^[a-z0-9/_-]{1,80}$/i).default("uploads"),
});

export async function POST(req: Request) {
  if (!storageEnabled()) return Response.json({ error: "Armazenamento R2 não configurado" }, { status: 400 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Requisição inválida" }, { status: 400 });
  try {
    return Response.json(await presignUpload(parsed.data));
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
