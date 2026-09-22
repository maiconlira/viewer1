import { db } from "./db";

export const SETTING_KEYS = {
  agency_profile: "Perfil da agência (serviços, planos, preços, diferenciais) — usado por todos os agentes",
  meeting_link: "Link de agendamento de reuniões (Calendly, Google Agenda...)",
  director_notes: "Instruções permanentes para o Diretor IA",
} as const;

export type SettingKey = keyof typeof SETTING_KEYS;

export async function getSetting(key: SettingKey) {
  const row = await db.setting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSetting(key: SettingKey, value: string) {
  return db.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
