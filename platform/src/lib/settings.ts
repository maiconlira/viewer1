import { db } from "./db";
import { decrypt, encrypt } from "./crypto";

/** Configurações editáveis na tela de Configurações. */
export const SETTING_KEYS = {
  agency_profile: "Perfil da agência (serviços, planos, preços, diferenciais) — usado por todos os agentes",
  meeting_link: "Link de agendamento externo (usado só se o Google Agenda não estiver conectado)",
  director_notes: "Instruções permanentes para o Diretor IA",
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;

/** Configurações operacionais com valor padrão. */
export const OPTION_DEFAULTS = {
  meeting_hours: "09:00-18:00", // janela de reuniões
  meeting_days: "1,2,3,4,5", // 0=dom ... 6=sáb
  meeting_duration: "30", // minutos
  reports_mode: "draft", // off | draft | send
  invoice_reminder_days: "3", // lembrete antes do vencimento
  auto_charge: "on", // gerar cobrança no Mercado Pago ao criar mensalidade
} as const;

export type OptionKey = keyof typeof OPTION_DEFAULTS;

type SecretKey = "google_refresh_token" | "google_email" | "meta_user_token" | "meta_user_name";

export async function getSetting(key: SettingKey) {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: SettingKey | OptionKey, value: string) {
  return db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function getOption(key: OptionKey): Promise<string> {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value || OPTION_DEFAULTS[key];
}

export async function getSecret(key: SecretKey) {
  const row = await db.setting.findUnique({ where: { key } });
  return decrypt(row?.value);
}

export async function setSecret(key: SecretKey, value: string | null) {
  if (value === null) {
    await db.setting.deleteMany({ where: { key } });
    return;
  }
  const enc = encrypt(value);
  await db.setting.upsert({ where: { key }, update: { value: enc }, create: { key, value: enc } });
}
