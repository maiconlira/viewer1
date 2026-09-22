// Criptografia de segredos guardados no banco (tokens da Meta, Google...). AES-256-GCM.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function key() {
  const secret = process.env.ENCRYPTION_KEY || process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-secret";
  return createHash("sha256").update(secret).digest();
}

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `enc:v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decrypt(value?: string | null): string | null {
  if (!value) return null;
  if (!value.startsWith("enc:v1:")) return value; // valor antigo/manual em texto puro
  const [, , iv, tag, data] = value.split(":");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
  } catch {
    console.error("[crypto] não foi possível descriptografar (ENCRYPTION_KEY mudou?)");
    return null;
  }
}
