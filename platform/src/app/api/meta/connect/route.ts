import { NextResponse } from "next/server";
import { metaAuthUrl, metaOAuthEnabled } from "@/lib/meta";
import { newOAuthState, redirectUri } from "@/lib/oauth";

export async function GET() {
  if (!metaOAuthEnabled()) return new Response("Configure META_APP_ID e META_APP_SECRET.", { status: 400 });
  return NextResponse.redirect(metaAuthUrl(redirectUri("meta"), await newOAuthState()));
}
