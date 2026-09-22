import { NextResponse } from "next/server";
import { disconnectGoogleCache } from "@/lib/google";
import { setSecret } from "@/lib/settings";
import { appUrl } from "@/lib/utils";

export async function POST() {
  await setSecret("google_refresh_token", null);
  await setSecret("google_email", null);
  disconnectGoogleCache();
  return NextResponse.redirect(appUrl("/configuracoes"), 303);
}
