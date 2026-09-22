// Google Agenda: conexão OAuth do dono da agência, consulta de horários livres e criação de reuniões com Meet.
import { randomUUID } from "node:crypto";
import { getSecret, setSecret } from "./settings";

const OAUTH = () => process.env.GOOGLE_OAUTH_BASE || "https://oauth2.googleapis.com";
const CAL = () => process.env.GOOGLE_CALENDAR_BASE || "https://www.googleapis.com/calendar/v3";
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly", "openid", "email"];

export function googleOAuthEnabled() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export async function googleConnected() {
  return googleOAuthEnabled() && Boolean(await getSecret("google_refresh_token"));
}

export function googleAuthUrl(redirectUri: string, state: string) {
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID!);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent");
  u.searchParams.set("state", state);
  return u.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${OAUTH()}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      ...params,
    }),
  });
  const json = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Google OAuth: ${json.error_description ?? json.error ?? res.status}`);
  return json;
}

export async function exchangeGoogleCode(code: string, redirectUri: string) {
  const t = await tokenRequest({ code, redirect_uri: redirectUri, grant_type: "authorization_code" });
  if (!t.refresh_token) throw new Error("O Google não devolveu refresh token — remova o acesso do app na sua conta Google e conecte de novo.");
  await setSecret("google_refresh_token", t.refresh_token);
  // e-mail da conta, só para exibir
  if (t.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(t.id_token.split(".")[1], "base64url").toString());
      if (payload.email) await setSecret("google_email", payload.email);
    } catch {
      /* opcional */
    }
  }
}

let cached: { token: string; expires: number } | null = null;

async function accessToken() {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const refresh = await getSecret("google_refresh_token");
  if (!refresh) throw new Error("Google Agenda não conectado.");
  const t = await tokenRequest({ refresh_token: refresh, grant_type: "refresh_token" });
  cached = { token: t.access_token!, expires: Date.now() + (t.expires_in ?? 3600) * 1000 };
  return cached.token;
}

export function disconnectGoogleCache() {
  cached = null;
}

async function cal<T>(path: string, init: { method?: string; body?: unknown } = {}) {
  const res = await fetch(`${CAL()}${path}`, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message: string } };
  if (!res.ok) throw new Error(`Google Agenda ${res.status}: ${json.error?.message ?? ""}`);
  return json as T;
}

export async function busyIntervals(from: Date, to: Date) {
  const r = await cal<{ calendars: Record<string, { busy: { start: string; end: string }[] }> }>("/freeBusy", {
    method: "POST",
    body: { timeMin: from.toISOString(), timeMax: to.toISOString(), items: [{ id: "primary" }] },
  });
  return (r.calendars.primary?.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
}

export async function createCalendarEvent(input: {
  title: string;
  description?: string;
  start: Date;
  end: Date;
  attendeeEmail?: string | null;
}) {
  const ev = await cal<{ id: string; htmlLink: string; hangoutLink?: string }>(
    `/calendars/primary/events?conferenceDataVersion=1&sendUpdates=${input.attendeeEmail ? "all" : "none"}`,
    {
      method: "POST",
      body: {
        summary: input.title,
        description: input.description,
        start: { dateTime: input.start.toISOString() },
        end: { dateTime: input.end.toISOString() },
        attendees: input.attendeeEmail ? [{ email: input.attendeeEmail }] : undefined,
        conferenceData: { createRequest: { requestId: randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } },
        reminders: { useDefault: true },
      },
    },
  );
  return { eventId: ev.id, eventLink: ev.htmlLink, meetLink: ev.hangoutLink };
}

export async function cancelCalendarEvent(eventId: string) {
  const res = await fetch(`${CAL()}/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${await accessToken()}` },
  });
  if (!res.ok && res.status !== 410 && res.status !== 404) throw new Error(`Google Agenda ${res.status}`);
}
