import { NextResponse } from "next/server";
import { publicUrl, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.redirect(publicUrl(req, "/login"), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
