// Geração de imagens e vídeos via fal.ai (modelos configuráveis por variável de ambiente).
// Imagens: chamada síncrona. Vídeos: fila assíncrona, finalizada pelo worker (/api/cron/tick).
import { db } from "./db";
import { logActivity } from "./activity";
import { mirrorToStorage } from "./storage";

export function mediaEnabled() {
  return Boolean(process.env.FAL_KEY);
}

const IMAGE_MODEL = () => process.env.FAL_IMAGE_MODEL || "fal-ai/flux/dev";
const VIDEO_MODEL = () => process.env.FAL_VIDEO_MODEL || "fal-ai/kling-video/v2.1/standard/text-to-video";

function headers() {
  return { Authorization: `Key ${process.env.FAL_KEY}`, "Content-Type": "application/json" };
}

/** Copia a mídia gerada para o R2 (link permanente); se o R2 não estiver configurado, mantém a URL original. */
async function persist(url: string, companyId?: string | null) {
  try {
    const m = await mirrorToStorage(url, `ai/${companyId ?? "geral"}`);
    if (m) return { url: m.publicUrl, key: m.key };
  } catch (err) {
    console.error("[media] falha ao copiar para o R2, usando URL original", err);
  }
  return { url, key: null as string | null };
}

type AspectRatio = "1:1" | "4:5" | "9:16" | "16:9";

const imageSizeFor: Record<AspectRatio, string> = {
  "1:1": "square_hd",
  "4:5": "portrait_4_3",
  "9:16": "portrait_16_9",
  "16:9": "landscape_16_9",
};

export async function generateImage(opts: {
  prompt: string;
  companyId?: string;
  postId?: string;
  aspectRatio?: AspectRatio;
}) {
  const asset = await db.mediaAsset.create({
    data: {
      kind: "IMAGE",
      prompt: opts.prompt,
      companyId: opts.companyId,
      postId: opts.postId,
      provider: "fal",
      status: "PROCESSING",
    },
  });

  if (!mediaEnabled()) {
    return db.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED", error: "FAL_KEY não configurada — adicione a chave para gerar imagens." },
    });
  }

  try {
    const res = await fetch(`https://fal.run/${IMAGE_MODEL()}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        prompt: opts.prompt,
        image_size: imageSizeFor[opts.aspectRatio ?? "4:5"],
        num_images: 1,
      }),
    });
    const json = (await res.json()) as { images?: { url: string }[]; detail?: unknown };
    if (!res.ok || !json.images?.[0]?.url) throw new Error(`fal ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    const stored = await persist(json.images[0].url, opts.companyId);
    const updated = await db.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "READY", url: stored.url, storageKey: stored.key },
    });
    await logActivity({
      type: "media.image",
      summary: `Imagem gerada${opts.postId ? " para postagem" : ""}`,
      companyId: opts.companyId,
    });
    return updated;
  } catch (err) {
    return db.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
    });
  }
}

export async function requestVideo(opts: {
  prompt: string;
  companyId?: string;
  postId?: string;
  aspectRatio?: AspectRatio;
  durationSeconds?: 5 | 10;
}) {
  const asset = await db.mediaAsset.create({
    data: {
      kind: "VIDEO",
      prompt: opts.prompt,
      companyId: opts.companyId,
      postId: opts.postId,
      provider: "fal",
      status: "PENDING",
    },
  });

  if (!mediaEnabled()) {
    return db.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED", error: "FAL_KEY não configurada — adicione a chave para gerar vídeos." },
    });
  }

  try {
    const res = await fetch(`https://queue.fal.run/${VIDEO_MODEL()}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        prompt: opts.prompt,
        aspect_ratio: opts.aspectRatio ?? "9:16",
        duration: String(opts.durationSeconds ?? 5),
      }),
    });
    const json = (await res.json()) as { request_id?: string; status_url?: string; response_url?: string };
    if (!res.ok || !json.request_id) throw new Error(`fal ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return db.mediaAsset.update({
      where: { id: asset.id },
      data: {
        status: "PROCESSING",
        externalId: json.request_id,
        statusUrl: json.status_url,
        resultUrl: json.response_url,
      },
    });
  } catch (err) {
    return db.mediaAsset.update({
      where: { id: asset.id },
      data: { status: "FAILED", error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/** Verifica vídeos em processamento e salva a URL final quando prontos. */
export async function pollPendingVideos() {
  if (!mediaEnabled()) return 0;
  const pending = await db.mediaAsset.findMany({
    where: { kind: "VIDEO", status: "PROCESSING", statusUrl: { not: null } },
    take: 20,
  });
  let done = 0;
  for (const asset of pending) {
    try {
      const statusRes = await fetch(asset.statusUrl!, { headers: headers() });
      const status = (await statusRes.json()) as { status?: string };
      if (status.status !== "COMPLETED") continue;
      const resultRes = await fetch(asset.resultUrl!, { headers: headers() });
      const result = (await resultRes.json()) as { video?: { url: string } };
      if (result.video?.url) {
        const stored = await persist(result.video.url, asset.companyId);
        await db.mediaAsset.update({ where: { id: asset.id }, data: { status: "READY", url: stored.url, storageKey: stored.key } });
        await logActivity({ type: "media.video", summary: "Vídeo gerado e pronto", companyId: asset.companyId });
        done++;
      } else {
        await db.mediaAsset.update({
          where: { id: asset.id },
          data: { status: "FAILED", error: JSON.stringify(result).slice(0, 500) },
        });
      }
    } catch (err) {
      console.error("[media] erro ao consultar vídeo", asset.id, err);
    }
  }
  return done;
}
