// Utilitários de OAuth (proteção CSRF com state em cookie).
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { appUrl } from "./utils";

const COOKIE = "oauth_state";

export async function newOAuthState(extra = "") {
  const state = `${randomBytes(16).toString("hex")}${extra ? `.${extra}` : ""}`;
  (await cookies()).set(COOKIE, state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 600, path: "/" });
  return state;
}

export async function checkOAuthState(state: string | null) {
  const store = await cookies();
  const expected = store.get(COOKIE)?.value;
  store.delete(COOKIE);
  return Boolean(state && expected && state === expected);
}

export const redirectUri = (provider: "meta" | "google") => appUrl(`/api/${provider}/callback`);
