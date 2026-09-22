import { NextResponse } from "next/server";
import { googleAuthUrl, googleOAuthEnabled } from "@/lib/google";
import { newOAuthState, redirectUri } from "@/lib/oauth";

export async function GET() {
  if (!googleOAuthEnabled()) return new Response("Configure GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.", { status: 400 });
  return NextResponse.redirect(googleAuthUrl(redirectUri("google"), await newOAuthState()));
}
