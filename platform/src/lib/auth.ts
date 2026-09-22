// Sessão do administrador único: cookie assinado com HMAC (Web Crypto, funciona no middleware edge).

export const SESSION_COOKIE = "agencia_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "dev-secret";
}

async function hmac(value: string) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken() {
  const expires = Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS;
  const payload = `admin.${expires}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(token?: string | null) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [who, expires, sig] = parts;
  if (Number(expires) < Date.now() / 1000) return false;
  const expected = await hmac(`${who}.${expires}`);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

export const sessionMaxAge = MAX_AGE_SECONDS;

/** URL absoluta respeitando o host público (proxy do Railway etc.), para redirects em route handlers. */
export function publicUrl(req: Request, path: string) {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (host?.startsWith("localhost") ? "http" : "https");
  return new URL(path, host ? `${proto}://${host}` : req.url);
}
