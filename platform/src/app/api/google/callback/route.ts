import { NextResponse } from "next/server";
import { exchangeGoogleCode } from "@/lib/google";
import { checkOAuthState, redirectUri } from "@/lib/oauth";
import { appUrl } from "@/lib/utils";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!(await checkOAuthState(url.searchParams.get("state")))) return new Response("state inválido", { status: 400 });
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(appUrl("/configuracoes?google=cancelado"));
  try {
    await exchangeGoogleCode(code, redirectUri("google"));
    return NextResponse.redirect(appUrl("/configuracoes?google=ok"));
  } catch (err) {
    console.error("[google oauth]", err);
    return NextResponse.redirect(appUrl(`/configuracoes?google=erro&msg=${encodeURIComponent((err as Error).message)}`));
  }
}
