import { NextResponse } from "next/server";
import { exchangeMetaCode } from "@/lib/meta";
import { checkOAuthState, redirectUri } from "@/lib/oauth";
import { setSecret } from "@/lib/settings";
import { appUrl } from "@/lib/utils";

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!(await checkOAuthState(url.searchParams.get("state")))) return new Response("state inválido", { status: 400 });
  const code = url.searchParams.get("code");
  if (!code) return NextResponse.redirect(appUrl("/configuracoes?meta=cancelado"));
  try {
    const { token, name } = await exchangeMetaCode(code, redirectUri("meta"));
    await setSecret("meta_user_token", token);
    await setSecret("meta_user_name", name);
    return NextResponse.redirect(appUrl("/configuracoes?meta=ok"));
  } catch (err) {
    console.error("[meta oauth]", err);
    return NextResponse.redirect(appUrl(`/configuracoes?meta=erro&msg=${encodeURIComponent((err as Error).message)}`));
  }
}
