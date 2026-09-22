// Armazenamento de arquivos no Cloudflare R2 (compatível com S3).
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomBytes } from "node:crypto";
import { zonedParts } from "./utils";

export function storageEnabled() {
  return Boolean(
    process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET &&
      process.env.R2_PUBLIC_URL &&
      (process.env.R2_ACCOUNT_ID || process.env.R2_ENDPOINT),
  );
}

let client: S3Client | null = null;
function s3() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: Boolean(process.env.R2_ENDPOINT),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

export function publicUrlFor(key: string) {
  return `${process.env.R2_PUBLIC_URL!.replace(/\/$/, "")}/${key}`;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "application/pdf": "pdf",
};

export const ALLOWED_UPLOAD_TYPES = Object.keys(EXT);
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500 MB

function newKey(folder: string, contentType: string) {
  const d = zonedParts(new Date());
  const month = `${d.year}-${String(d.month).padStart(2, "0")}`;
  return `${folder}/${month}/${randomBytes(10).toString("hex")}.${EXT[contentType] ?? "bin"}`;
}

/** URL assinada para o navegador enviar o arquivo direto ao R2 (sem passar pelo servidor). */
export async function presignUpload(opts: { folder: string; contentType: string; size: number }) {
  if (!ALLOWED_UPLOAD_TYPES.includes(opts.contentType)) throw new Error("Tipo de arquivo não permitido");
  if (opts.size > MAX_UPLOAD_BYTES) throw new Error("Arquivo muito grande (máx. 500 MB)");
  const key = newKey(opts.folder, opts.contentType);
  const uploadUrl = await getSignedUrl(
    s3(),
    new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, ContentType: opts.contentType }),
    { expiresIn: 600 },
  );
  return { key, uploadUrl, publicUrl: publicUrlFor(key) };
}

/** Copia um arquivo de uma URL externa (ex.: imagem gerada por IA) para o R2, garantindo link permanente. */
export async function mirrorToStorage(url: string, folder: string) {
  if (!storageEnabled()) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download falhou (${res.status})`);
  const contentType = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  const body = Buffer.from(await res.arrayBuffer());
  const key = newKey(folder, contentType);
  await s3().send(new PutObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return { key, publicUrl: publicUrlFor(key) };
}
