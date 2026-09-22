import { NextResponse } from "next/server";
import { createSessionToken, publicUrl, SESSION_COOKIE, sessionMaxAge } from "@/lib/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/") || "/";
  const expected = process.env.ADMIN_PASSWORD;
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";

  if (!expected || password !== expected) {
    return NextResponse.redirect(publicUrl(req, `/login?error=1&next=${encodeURIComponent(safeNext)}`), 303);
  }
  const res = NextResponse.redirect(publicUrl(req, safeNext), 303);
  res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: sessionMaxAge,
    path: "/",
  });
  return res;
}
